import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, cpSync, appendFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {devVersion} from '../src/dev.mjs';

test('development watcher detects web changes, restarts backend and keeps error logs visible', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tobari dev '));
  for (const name of ['src', 'web']) cpSync(fileURLToPath(new URL('../' + name, import.meta.url)), join(dir, name), {recursive: true});
  const probe = createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const child = spawn(process.execPath, ['--watch', '--watch-preserve-output', '--disable-warning=ExperimentalWarning', join(dir, 'src/server.mjs'), '--dev', '--no-auth', '--port', String(port), '--db', join(dir, 'local.sqlite')]);
  let output = '';
  child.stdout.on('data', c => {output += c;});
  child.stderr.on('data', c => {output += c;});
  async function until(check) {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      try { const result = await check(); if (result) return result; } catch {}
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    throw new Error('Watcher did not become ready: ' + output);
  }
  const origin = `http://127.0.0.1:${port}`;
  const version = async () => (await (await fetch(origin + '/__dev/version', {signal: AbortSignal.timeout(500)})).json()).version;
  try {
    await until(() => output.includes('Ctrl+C to stop.'));
    const first = await version();
    const html = await (await fetch(origin)).text();
    assert.match(html, /src="\/__dev\/reload.js"/);
    assert.ok(html.includes(first));
    appendFileSync(join(dir, 'web/style.css'), '\n/* development test */\n');
    const changed = await until(async () => {const v = await version(); return v !== first && v;});
    appendFileSync(join(dir, 'src/server.mjs'), '\n/* backend change */\n');
    await until(async () => {const v = await version(); return v !== changed && v;});
    // Node's native watcher can require manual restart after an entrypoint syntax error.
    // Check that the error stays visible and the watcher does not close the bat window.
    appendFileSync(join(dir, 'src/server.mjs'), '\n/*');
    await until(() => output.includes('SyntaxError') && output.includes('Waiting for file changes'));
    assert.equal(child.exitCode, null, 'watcher must stay alive after a source error');
  } finally {
    if (child.exitCode === null) {
      if (process.platform === 'win32') {
        const cleanup = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {stdio: 'ignore'});
        await new Promise(resolve => cleanup.once('exit', resolve));
      } else {
        const stopped = new Promise(resolve => child.once('exit', resolve));
        child.kill(); await stopped;
      }
    }
  }
});

test('development version is stable until contents change and differs across boots', () => {
  const file = new URL('../web/index.html', import.meta.url);
  const version = devVersion(new Map([['/', file]]));
  assert.equal(version(), version());
  assert.notEqual(version(), devVersion(new Map([['/', file]]))());
});
