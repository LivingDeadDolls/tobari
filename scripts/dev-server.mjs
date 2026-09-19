import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync, readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const source = new URL('../src/', import.meta.url);
const server = fileURLToPath(new URL('server.mjs', source));
function fingerprint() {
  const hash = createHash('sha256');
  for (const name of readdirSync(source).filter(name => name.endsWith('.mjs')).sort()) {
    hash.update(name).update(readFileSync(new URL(name, source)));
  }
  return hash.digest('hex');
}
let previous = fingerprint(), child, stopping = false, restarting = false, killTimer;
function stopChild() {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  clearTimeout(killTimer);
  const target = child;
  child.kill();
  killTimer = setTimeout(() => target.kill('SIGKILL'), 2500);
  killTimer.unref();
}
function start() {
  restarting = false;
  child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', server, '--dev', ...process.argv.slice(2)], {stdio: 'inherit'});
  child.on('error', error => console.error(`DEV: ${error.message}`));
  child.on('close', () => {
    clearTimeout(killTimer);
    child = null;
    if (stopping) return;
    if (restarting) start();
    else console.error('DEV: server stopped; waiting for source changes. This window stays open.');
  });
}
start();
const timer = setInterval(() => {
  if (stopping) return;
  let next;
  try { next = fingerprint(); } catch { return; } // Atomic-save intermediate state.
  if (next === previous) return;
  previous = next;
  console.log('DEV: source changed; restarting server.');
  if (child) { restarting = true; stopChild(); }
  else start();
}, 500);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  if (stopping) return;
  stopping = true;
  clearInterval(timer);
  stopChild();
});
