import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

// No watchers on the DB: only frontend contents and a server boot ID trigger reloads.
export function devVersion(assets) {
  const boot = randomUUID();
  return () => {
    const hash = createHash('sha256').update(boot);
    for (const file of assets.values()) hash.update(readFileSync(file));
    return hash.digest('hex');
  };
}

export const reloadScript = `(() => {
  const initial = document.currentScript.dataset.version;
  async function check() {
    try {
      const response = await fetch('/__dev/version', {cache: 'no-store', signal: AbortSignal.timeout(2000)});
      if (response.ok) {
        const {version} = await response.json();
        // Preserve an in-progress registration until its dialog is closed.
        if (version !== initial && !document.querySelector('dialog[open]')) {
          location.reload();
          return;
        }
      }
    } catch { /* The watcher may be restarting a server with a temporary syntax error. */ }
    setTimeout(check, 1000);
  }
  setTimeout(check, 1000);
})();`;
