import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const cli = fileURLToPath(new URL('../src/cli.mjs', import.meta.url));
const db = join(mkdtempSync(join(tmpdir(), 'tobari-demo-')), 'local.sqlite');
function run(args, input) {
  const result = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', cli, ...args, '--db', db], { encoding: 'utf8', input: input === undefined ? undefined : JSON.stringify(input) });
  if (result.status !== 0 || result.stderr) throw new Error(result.stderr);
  return JSON.parse(result.stdout);
}
const plan = run(['start', '--prepare', '--task', 'demo', '--title', 'ログイン不具合', '--provider', 'codex']);
const hook = (hook_event_name, extra = {}) => run(['hook', '--launch', plan.launch], { session_id: 'simulated-main', hook_event_name, ...extra });
const view = () => run(['show', '--task', 'demo']);
console.log('疑似hookによるローカル動作デモ（AI・外部通信なし）');
hook('SessionStart');
hook('UserPromptSubmit');
let main = view().launches[0].actors[0].id;
run(['report', '--actor', main], { revision: 1, status: 'in_progress', summary: '原因を特定。修正は未着手' });
console.log(`${view().status}: ${view().summary}`);
hook('SubagentStart', { agent_id: 'simulated-reviewer' });
hook('SubagentStop', { agent_id: 'simulated-reviewer' });
hook('Stop');
console.log(`子と主の応答終了後: ${view().status}（完了を推測しない）`);
run(['report', '--actor', main], { revision: 2, status: 'completed', summary: '修正・確認済み。残件なし', conclusion: 'デモ用の完了報告', rationale: '明示的な報告で状態を更新', evidence: '疑似イベントによるデモ。実際の不具合修正はしていない', remaining: 'なし' });
console.log(`${view().status}: ${view().summary}`);
console.log(`記録: ${db}`);
