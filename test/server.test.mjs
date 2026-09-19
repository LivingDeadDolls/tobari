import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { openStore } from "../src/store.mjs";
import { flush, saveConfig } from "../src/client.mjs";

const serverFile = fileURLToPath(new URL("../src/server.mjs", import.meta.url));
const cliFile = fileURLToPath(new URL("../src/cli.mjs", import.meta.url));
async function availablePort() {
  const socket = createServer();
  await new Promise((r) => socket.listen(0, "127.0.0.1", r));
  const port = socket.address().port;
  await new Promise((r) => socket.close(r));
  return port;
}
async function start(dir, port) {
  const child = spawn(process.execPath, [
    "--disable-warning=ExperimentalWarning",
    serverFile,
    "--port",
    String(port),
    "--db",
    join(dir, "server.sqlite"),
    "--token-file",
    join(dir, "key.txt"),
  ]);
  let output = "";
  child.stderr.on("data", (chunk) => {
    output += chunk;
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(output || "Server timeout"));
    }, 10000);
    child.stdout.on("data", (chunk) => {
      output += chunk;
      if (output.includes("Keep this window open")) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Server exited ${code}: ${output}`));
    });
  });
  return child;
}
async function stop(child) {
  if (child.exitCode !== null) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill();
  await exited;
}
async function cli(args, input, env = {}) {
  const child = spawn(
    process.execPath,
    ["--disable-warning=ExperimentalWarning", cliFile, ...args],
    { env: { ...process.env, ...env } },
  );
  let stdout = "",
    stderr = "";
  child.stdout.on("data", (c) => {
    stdout += c;
  });
  child.stderr.on("data", (c) => {
    stderr += c;
  });
  child.stdin.end(input === undefined ? "" : JSON.stringify(input));
  const code = await new Promise((r) => child.on("exit", r));
  assert.equal(code, 0, stderr);
  return stdout;
}

test("authenticated server: registration, remote CLI hooks, offline recovery, deduplication and restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tobari server ")),
    port = await availablePort();
  let child = await start(dir, port);
  const origin = `http://127.0.0.1:${port}`,
    token = readFileSync(join(dir, "key.txt"), "utf8").trim();
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
  const configPath = join(dir, "client.json");
  const config = saveConfig(configPath, origin, token);
  try {
    assert.equal((await fetch(origin + "/")).status, 200);
    assert.equal((await fetch(origin + "/api/tasks")).status, 401);
    assert.equal(
      (
        await fetch(origin + "/api/tasks", {
          headers: { ...headers, Origin: "http://evil.example" },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(origin + "/api/login", {
          method: "POST",
          headers,
          body: JSON.stringify({ token: "wrong" }),
        })
      ).status,
      401,
    );
    const login = await fetch(origin + "/api/login", {
      method: "POST",
      headers,
      body: JSON.stringify({ token }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie");
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    assert.equal(
      (
        await fetch(origin + "/api/tasks", {
          headers: { Cookie: cookie.split(";")[0] },
        })
      ).status,
      200,
    );
    const create = await fetch(origin + "/api/tasks", {
      method: "POST",
      headers,
      body: JSON.stringify({
        title: "日本語 & ' task",
        cwd: dir,
        request: "テストして結果を報告",
        links: ["https://github.com/example/repo/issues/1"],
      }),
    });
    assert.equal(create.status, 201);
    const task = await create.json();
    assert.equal(task.launches.length, 0);
    assert.equal(task.status, "unreported");
    const plan = JSON.parse(
      await cli([
        "start",
        "--prepare",
        "--config",
        configPath,
        "--task",
        task.task,
        "--provider",
        "codex",
      ]),
    );
    assert.equal(plan.cwd, dir);
    assert.doesNotMatch(JSON.stringify(plan.hooks), new RegExp(plan.launch));
    const hookEnv = { ...plan.env, TOBARI_CONFIG: configPath };
    const hook = JSON.parse(
      await cli(
        ["hook"],
        {
          hook_event_name: "SessionStart",
          session_id: "session",
          prompt: "NEVER_SEND_RAW_PROMPT",
        },
        hookEnv,
      ),
    );
    assert.match(hook.hookSpecificOutput.additionalContext, /whole task/);
    await stop(child);
    await cli(
      ["hook"],
      {
        hook_event_name: "PreToolUse",
        session_id: "session",
        tool_input: { command: "NEVER_SEND_RAW_COMMAND" },
      },
      hookEnv,
    );
    let local = openStore(config.db);
    const actor = local.snapshot(task.task).launches[0].actors[0].id;
    local.close();
    await cli(["report", "--config", configPath, "--actor", actor], {
      revision: 1,
      status: "completed",
      summary: "修正・確認完了",
      conclusion: "修正済み",
      rationale: "条件を満たす",
      evidence: "test passed",
      remaining: "なし",
    });
    local = openStore(config.db);
    assert.equal(local.pending().length, 2);
    const queued = local.pending();
    assert.doesNotMatch(JSON.stringify(queued), /NEVER_SEND_RAW/);
    child = await start(dir, port);
    assert.equal(await flush(local, config), 2);
    assert.equal(local.pending().length, 0);
    local.close();
    const retry = await fetch(origin + "/api/sync", {
      method: "POST",
      headers,
      body: JSON.stringify({ operations: queued }),
    });
    assert.equal(retry.status, 200);
    let data = await (await fetch(origin + "/api/tasks", { headers })).json();
    assert.equal(data.tasks[0].status, "completed");
    assert.equal(
      data.tasks[0].launches[0].events.filter(
        (e) => e.kind === "ProgressReport",
      ).length,
      1,
    );
    assert.doesNotMatch(JSON.stringify(data), /NEVER_SEND_RAW/);
    assert.equal(data.tasks[0].request, "テストして結果を報告");
    assert.equal(readFileSync(join(dir, "key.txt"), "utf8").trim(), token);
    await cli(["doctor", "--config", configPath]);
  } finally {
    await stop(child);
  }
});

test("task validation and old prototype database coexist", () => {
  const dir = mkdtempSync(join(tmpdir(), "tobari-migration-"));
  const store = openStore(join(dir, "store.sqlite"));
  try {
    store.create({
      task: "legacy",
      title: "Legacy",
      provider: "claude",
      cwd: dir,
    });
    assert.equal(store.snapshot("legacy").title, "Legacy");
    assert.throws(() => store.register({ title: "", cwd: dir }));
    assert.throws(() =>
      store.register({ title: "x", cwd: dir, links: ["javascript:alert(1)"] }),
    );
    const task = store.register({
      title: "Registered",
      cwd: "C:\\projects\\example",
    });
    assert.equal(store.snapshot(task.id).cwd, "C:\\projects\\example");
    assert.equal(store.taskIds().length, 2);
  } finally {
    store.close();
  }
});

test('Windows bat keeps the server in the foreground and serves HTTP', {skip: process.platform !== 'win32'}, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tobari bat '));
  const port = await availablePort();
  const bat = fileURLToPath(new URL('../start.bat', import.meta.url));
  const command = `""${bat}" --port ${port} --db "${join(dir, 'server.sqlite')}" --token-file "${join(dir, 'key.txt')}""`;
  const child = spawn('cmd.exe', ['/d', '/s', '/c', command], {windowsVerbatimArguments: true});
  let output = '';
  child.stderr.on('data', chunk => { output += chunk; });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('bat startup timeout: ' + output)), 20000);
      child.stdout.on('data', chunk => {
        output += chunk;
        if (output.includes('Keep this window open')) { clearTimeout(timer); resolve(); }
      });
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`bat exited early (${code}): ${output}`)); });
    });
    assert.equal(child.exitCode, null, 'bat must remain running while the server runs');
    assert.match(output, /RUNNING/);
    assert.equal((await fetch(`http://127.0.0.1:${port}/`)).status, 200);
    assert.equal(child.exitCode, null);
  } finally {
    if (child.exitCode === null && child.pid) {
      // Only terminate this test's explicitly identified cmd process and its server child.
      const cleanup = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {stdio: 'ignore'});
      await new Promise(resolve => cleanup.once('exit', resolve));
    }
  }
});
