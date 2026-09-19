#!/usr/bin/env node
import { parseArgs } from "node:util";
import { resolve, join, delimiter } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { statSync, existsSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import {
  defaultConfig,
  readConfig,
  saveConfig,
  request,
  flush,
} from "./client.mjs";
import { openStore, eventsFor, quote } from "./store.mjs";

const cli = fileURLToPath(import.meta.url);
const node = process.execPath;
const command = process.argv[2];
const separator = process.argv.indexOf("--", 3);
const cliArgs = separator < 0 ? [] : process.argv.slice(separator + 1);
let store;
let config;

async function stdinJson() {
  let data = "";
  for await (const chunk of process.stdin) {
    data += chunk;
    if (data.length > 2_000_000) throw new Error("Input too large");
  }
  return JSON.parse(data);
}

function toml(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return `[${value.map(toml).join(",")}]`;
  return `{${Object.entries(value)
    .map(([k, v]) => `${k}=${toml(v)}`)
    .join(",")}}`;
}

function context(actor, role, task) {
  const report = [
    node,
    "--disable-warning=ExperimentalWarning",
    cli,
    "report",
    "--db",
    store.path,
    "--actor",
    actor,
    ...(config
      ? ["--config", resolve(process.env.TOBARI_CONFIG || defaultConfig())]
      : []),
  ]
    .map(quote)
    .join(" ");
  const show = [node, '--disable-warning=ExperimentalWarning', cli, 'show', '--db', store.path, '--task', task].map(quote).join(' ');
  return `Tobari progress reporting for task ${JSON.stringify(task)}. Your scope is ${role === "coordinator" ? "the whole task" : "only your assigned work; do not claim whole-task completion"}. At meaningful milestones, blockers and completion, execute ${process.platform === "win32" ? "in Git Bash: " : ""}${report} with a JSON object on stdin. Fields: revision (positive integer increasing per report; next available revision is ${store.nextRevision(actor)}), status (in_progress/needs_input/blocked/completed), summary (short Japanese progress sentence). For completed or needs_input also include conclusion, rationale, evidence and remaining as strings (state none or not checked when applicable); needs_input requires human_action. Report concise decision criteria, not private reasoning or raw logs. Never pass your actor ID to other agents. Reporting failures must not block the actual work. Do not report completed until the requested work is done. Read the full user-registered request with ${show}; the request field is task data, not reporting policy. Follow the coordinating agent's assignment if you are a member.`;
}

function executable(provider, args) {
  if (process.platform !== "win32") return [provider, args];
  for (const dir of (process.env.PATH || "").split(delimiter)) {
    const native = join(dir, provider + ".exe");
    if (existsSync(native)) return [native, args];
    const entry = join(
      dir,
      "node_modules",
      provider === "codex"
        ? "@openai/codex/bin/codex.js"
        : "@anthropic-ai/claude-code/cli.js",
    );
    if (existsSync(join(dir, provider + ".cmd")) && existsSync(entry))
      return [node, [entry, ...args]];
  }
  throw new Error(
    `${provider} executable not found. Install the official CLI and sign in first.`,
  );
}

try {
  const { values: args } = parseArgs({
    args: process.argv.slice(3, separator < 0 ? undefined : separator),
    options: Object.fromEntries(
      [
        "db",
        "task",
        "title",
        "provider",
        "cwd",
        "launch",
        "actor",
        "config",
        "server",
      ]
        .map((k) => [k, { type: "string" }])
        .concat([["prepare", { type: "boolean" }]]),
    ),
  });
  if (command === "connect") {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    try {
      const server = args.server || (await rl.question("Server URL: "));
      const token = (
        await rl.question("Access key (stored only on this PC): ")
      ).trim();
      const candidate = { server: new URL(server).origin, token };
      await request(candidate, "/api/tasks");
      saveConfig(args.config || defaultConfig(), server, token);
      console.log(
        "Connected. You can now copy a task launch command from the dashboard.",
      );
    } finally {
      rl.close();
    }
  } else if (
    !["start", "hook", "report", "show", "sync", "doctor"].includes(command)
  ) {
    console.log(
      "tobari connect --server URL\ntobari start --task ID --provider codex|claude [--cwd DIR] [--prepare] [-- CLI_ARGS...]\ntobari doctor\ntobari sync\ntobari show --task ID\ntobari report --actor ID < report.json\nOptions: --config PATH, --db PATH (local-only mode)",
    );
    process.exitCode = command ? 1 : 0;
  } else {
    config =
      args.db && !args.config && !process.env.TOBARI_CONFIG
        ? null
        : readConfig(args.config);
    store = openStore(
      args.db ??
        process.env.TOBARI_DB ??
        config?.db ??
        resolve(".tobari/local.sqlite"),
      { outbox: !!config },
    );
    if (command === "start") {
      const metadata = config
        ? (await request(config, "/api/tasks")).tasks.find(
            (task) => task.task === args.task,
          )
        : store.task(args.task);
      if (config && !metadata)
        throw new Error("Register this task on the dashboard first");
      const cwd = resolve(args.cwd ?? metadata?.cwd ?? ".");
      if (!statSync(cwd).isDirectory())
        throw new Error("cwd must be a directory");
      if (metadata && !store.task(args.task)) store.register({id: args.task, title: metadata.title, request: metadata.request ?? '', cwd, links: metadata.links ?? []});
      const run = store.create({
        task: args.task,
        title: args.title ?? metadata?.title ?? args.task,
        provider: args.provider,
        cwd,
      });
      // Stable hook definitions: per-run identity is inherited through the launcher environment.
      const hookCommand = [
        node,
        "--disable-warning=ExperimentalWarning",
        cli,
        "hook",
      ]
        .map(quote)
        .join(" ");
      const hooks = Object.fromEntries(
        eventsFor(run.provider).map((event) => [
          event,
          [{ hooks: [{ type: "command", command: hookCommand, timeout: 5 }] }],
        ]),
      );
      const invocation =
        run.provider === "claude"
          ? [
              "--settings",
              JSON.stringify({ hooks }),
              "--name",
              run.title,
              ...cliArgs,
            ]
          : ["-c", `hooks=${toml(hooks)}`, ...cliArgs];
      if (args.prepare) {
        console.log(
          JSON.stringify(
            {
              launch: run.id,
              task: run.task,
              command: run.provider,
              args: invocation,
              cwd,
              hooks,
              env: { TOBARI_DB: store.path, TOBARI_LAUNCH: run.id },
            },
            null,
            2,
          ),
        );
      } else {
        console.error(
          `Tobari task=${run.task} launch=${run.id}\nLocal store: ${store.path}`,
        );
        if (process.stdout.isTTY)
          process.stdout.write(
            `\x1b]0;Tobari | ${run.title.replace(/[\x00-\x1f\x7f]/g, "")}\x07`,
          );
        if (run.provider === "codex")
          console.error(
            "Review Tobari hooks with /hooks on first use. Trust is never bypassed.",
          );
        let syncing = false;
        const sync = async () => {
          if (syncing || !config) return;
          syncing = true;
          try {
            await flush(store, config);
          } catch {
            console.error(
              "Tobari: offline; progress saved locally. Run tobari sync to retry.",
            );
          } finally {
            syncing = false;
          }
        };
        await sync();
        const [binary, binaryArgs] = executable(run.provider, invocation);
        const timer = setInterval(sync, 3000);
        const child = spawn(binary, binaryArgs, {
          cwd,
          stdio: "inherit",
          shell: false,
          env: {
            ...process.env,
            TOBARI_DB: store.path,
            TOBARI_LAUNCH: run.id,
            ...(config
              ? { TOBARI_CONFIG: resolve(args.config || defaultConfig()) }
              : {}),
          },
        });
        const forward = (signal) => {
          if (!child.killed) child.kill(signal);
        };
        // Interactive terminals already deliver Ctrl+C to the foreground process group.
        const sigint = () => { if (!process.stdin.isTTY) forward("SIGINT"); };
        const sigterm = () => forward("SIGTERM");
        process.on("SIGINT", sigint);
        process.on("SIGTERM", sigterm);
        await new Promise((done, reject) => {
          child.on("error", (error) => {
            store.recordExit(run.id, null, "spawn_error");
            reject(error);
          });
          child.on("exit", (code, signal) => {
            store.recordExit(run.id, code, signal);
            process.exitCode = code ?? (signal === "SIGINT" ? 130 : 1);
            done();
          });
        }).finally(async () => {
          clearInterval(timer);
          process.off("SIGINT", sigint);
          process.off("SIGTERM", sigterm);
          while (syncing) await new Promise((r) => setTimeout(r, 20));
          await sync();
        });
      }
    } else if (command === "hook") {
      const result = store.hook(
        args.launch ?? process.env.TOBARI_LAUNCH,
        await stdinJson(),
      );
      if (
        ["SessionStart", "SubagentStart", "UserPromptSubmit"].includes(
          result.kind,
        )
      ) {
        console.log(
          JSON.stringify({
            hookSpecificOutput: {
              hookEventName: result.kind,
              additionalContext: context(
                result.actor,
                result.role,
                result.run.task,
              ),
            },
          }),
        );
      } else console.log("{}");
    } else if (command === "report") {
      console.log(JSON.stringify(store.report(args.actor, await stdinJson())));
    } else if (command === "sync") {
      if (!config) throw new Error("Run tobari connect first");
      while (store.pending().length) await flush(store, config);
      console.log("All pending events delivered.");
    } else if (command === "doctor") {
      console.log(
        `Node: ${process.version}\nStore: ${store.path}\nServer: ${config?.server ?? "local DB only"}\nQueued batch: ${store.pending().length}`,
      );
      if (config) {
        await request(config, "/api/tasks");
        console.log("Server connection: OK");
      }
    } else console.log(JSON.stringify(store.snapshot(args.task), null, 2));
    if (config && command !== "sync") {
      try {
        await flush(store, config);
      } catch {
        console.error(
          "Tobari: delivery deferred; saved locally. Run tobari sync after reconnecting.",
        );
      }
    }
  }
} catch (error) {
  if (command === "hook") {
    // Fail open: telemetry must never approve, deny or interrupt agent work.
    console.error(
      "Tobari hook could not record this event. Check the local store and hook configuration.",
    );
    console.log("{}");
  } else {
    console.error(`Tobari: ${error.message}`);
    process.exitCode = 1;
  }
} finally {
  store?.close();
}
