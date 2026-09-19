import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { openStore } from "../src/store.mjs";

const cli = fileURLToPath(new URL("../src/cli.mjs", import.meta.url));
const invoke = (args, input) =>
  spawnSync(
    process.execPath,
    ["--disable-warning=ExperimentalWarning", cli, ...args],
    {
      input: input === undefined ? undefined : JSON.stringify(input),
      encoding: "utf8",
    },
  );
const report = (revision, status = "completed") => ({
  revision,
  status,
  summary: "修正と確認が完了",
  conclusion: "期待する結果を確認",
  rationale: "依頼の完了条件と照合",
  evidence: "テスト成功",
  remaining: "なし",
});

for (const provider of ["codex", "claude"]) {
  test(`${provider}: CLI start → hooks → child → report → stop`, () => {
    const dir = mkdtempSync(join(tmpdir(), "tobari-test-"));
    const db = join(dir, "local.sqlite");
    const prepared = invoke([
      "start",
      "--prepare",
      "--db",
      db,
      "--task",
      "task-1",
      "--title",
      "Task '$() name",
      "--provider",
      provider,
    ]);
    assert.equal(prepared.status, 0, prepared.stderr);
    const plan = JSON.parse(prepared.stdout);
    const hook = (input) => {
      const result = invoke(["hook", "--db", db, "--launch", plan.launch], {
        session_id: "session-1",
        ...input,
      });
      assert.equal(result.status, 0, result.stderr);
      return JSON.parse(result.stdout);
    };
    const output = hook({ hook_event_name: "SessionStart", source: "startup" });
    assert.match(output.hookSpecificOutput.additionalContext, /whole task/);
    hook({
      hook_event_name: "UserPromptSubmit",
      prompt: "DO_NOT_STORE_PROMPT",
    });
    hook({
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command: "DO_NOT_STORE_COMMAND" },
    });
    hook({
      hook_event_name: "PostToolUse",
      tool_name: "Bash",
      tool_response: "DO_NOT_STORE_OUTPUT",
    });
    const child = hook({
      hook_event_name: "SubagentStart",
      agent_id: "child-1",
      agent_type: "reviewer",
    });
    assert.match(
      child.hookSpecificOutput.additionalContext,
      /only your assigned work/,
    );
    let view = JSON.parse(
      invoke(["show", "--db", db, "--task", "task-1"]).stdout,
    );
    const actors = view.launches[0].actors;
    const main = actors.find((a) => a.role === "coordinator");
    const member = actors.find((a) => a.role === "member");
    assert.equal(
      invoke(["report", "--db", db, "--actor", member.id], report(1)).status,
      0,
    );
    hook({
      hook_event_name: "SubagentStop",
      agent_id: "child-1",
      last_assistant_message: "DO_NOT_STORE_FINAL",
    });
    if (provider === "claude")
      hook({ hook_event_name: "TaskCompleted", task_id: "internal-1" });
    hook({ hook_event_name: "Stop", last_assistant_message: "Finished!" });
    view = JSON.parse(invoke(["show", "--db", db, "--task", "task-1"]).stdout);
    assert.equal(view.status, "unreported");
    assert.equal(
      invoke(["report", "--db", db, "--actor", main.id], report(2)).status,
      0,
    );
    // An old in-progress report and a duplicate cannot override a newer completion.
    invoke(
      ["report", "--db", db, "--actor", main.id],
      report(1, "in_progress"),
    );
    const duplicate = invoke(
      ["report", "--db", db, "--actor", main.id],
      report(2),
    );
    assert.equal(JSON.parse(duplicate.stdout).duplicate, true);
    assert.equal(
      invoke(["report", "--db", db, "--actor", main.id], report(2, "blocked"))
        .status,
      1,
    );
    view = JSON.parse(invoke(["show", "--db", db, "--task", "task-1"]).stdout);
    assert.equal(view.status, "completed");
    hook({ hook_event_name: "UserPromptSubmit", prompt: "Explain the result" });
    assert.equal(
      JSON.parse(invoke(["show", "--db", db, "--task", "task-1"]).stdout)
        .status,
      "completed",
    );
    invoke(
      ["report", "--db", db, "--actor", main.id],
      report(3, "in_progress"),
    );
    hook({ hook_event_name: "SessionStart", source: "resume" });
    view = JSON.parse(invoke(["show", "--db", db, "--task", "task-1"]).stdout);
    assert.equal(view.status, "in_progress");
    assert.equal(view.launches[0].actors.length, 2);
    for (const file of readdirSync(dir))
      assert.doesNotMatch(
        readFileSync(join(dir, file)).toString(),
        /DO_NOT_STORE_/,
      );
  });
}

test("invalid reports, missing identity and task switching are rejected", () => {
  const db = join(
    mkdtempSync(join(tmpdir(), "tobari-validation-")),
    "local.sqlite",
  );
  const store = openStore(db);
  try {
    const one = store.create({
      task: "one",
      title: "One",
      provider: "codex",
      cwd: ".",
    });
    const two = store.create({
      task: "two",
      title: "Two",
      provider: "codex",
      cwd: ".",
    });
    const actor = store.hook(one.id, {
      hook_event_name: "SessionStart",
      session_id: "s",
    }).actor;
    assert.throws(
      () =>
        store.hook(two.id, {
          hook_event_name: "SessionStart",
          session_id: "s",
        }),
      /already linked/,
    );
    assert.throws(
      () =>
        store.hook(one.id, {
          hook_event_name: "SubagentStart",
          session_id: "s",
        }),
      /identity/,
    );
    assert.throws(() => store.report("unknown", report(1)), /Unknown actor/);
    assert.throws(
      () =>
        store.report(actor, {
          revision: 1,
          status: "completed",
          summary: "done",
        }),
      /conclusion/,
    );
    assert.throws(
      () => store.report(actor, report(1, "needs_input")),
      /human_action/,
    );
    store.recordExit(one.id, 0, null);
    assert.equal(store.snapshot("one").status, "unreported");
  } finally {
    store.close();
  }
  const malformed = invoke(["hook", "--db", db, "--launch", "unknown"], {
    prompt: "PRIVATE",
  });
  assert.equal(malformed.status, 0);
  assert.deepEqual(JSON.parse(malformed.stdout), {});
  assert.doesNotMatch(malformed.stderr, /PRIVATE/);
});

test("simultaneous hook processes preserve all child registrations", async () => {
  const db = join(
    mkdtempSync(join(tmpdir(), "tobari-parallel-")),
    "local.sqlite",
  );
  const store = openStore(db);
  const run = store.create({
    task: "parallel",
    title: "Parallel",
    provider: "claude",
    cwd: ".",
  });
  store.hook(run.id, { hook_event_name: "SessionStart", session_id: "s" });
  await Promise.all(
    Array.from(
      { length: 8 },
      (_, i) =>
        new Promise((done, reject) => {
          const child = spawn(process.execPath, [
            "--disable-warning=ExperimentalWarning",
            cli,
            "hook",
            "--db",
            db,
            "--launch",
            run.id,
          ]);
          let errors = "";
          child.stderr.on("data", (chunk) => {
            errors += chunk;
          });
          child.stdout.resume();
          child.on("error", reject);
          child.on("exit", (code) =>
            code === 0 && !errors ? done() : reject(new Error(errors)),
          );
          child.stdin.end(
            JSON.stringify({
              hook_event_name: "SubagentStart",
              session_id: "s",
              agent_id: `child-${i}`,
            }),
          );
        }),
    ),
  );
  try {
    assert.equal(store.snapshot("parallel").launches[0].actors.length, 9);
  } finally {
    store.close();
  }
});
