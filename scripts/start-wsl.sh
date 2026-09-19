#!/usr/bin/env bash
set -e
mode="$1"
shift
if ! command -v node >/dev/null 2>&1; then
  echo 'Tobari ERROR: Node.js 22.13 or newer is required inside this WSL distribution.' >&2
  exit 1
fi
node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)' || {
  echo 'Tobari ERROR: Update Node.js inside this WSL distribution to 22.13 or newer.' >&2
  exit 1
}
if [ "$mode" = dev ]; then
  exec node --disable-warning=ExperimentalWarning scripts/dev-server.mjs "$@"
fi
exec node --disable-warning=ExperimentalWarning src/server.mjs "$@"
