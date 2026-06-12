#!/usr/bin/env bash
# Production entrypoint — runs compiled JS directly (no npm/tsx wrapper).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=384}"

CLI="$ROOT/apps/core/dist/cli.js"
ENV_FILE="$ROOT/.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE" >&2
  exit 1
fi

if [ ! -f "$CLI" ]; then
  echo "Missing $CLI — run: npm run build --workspace=@maximus/core" >&2
  exit 1
fi

for pkg in "$ROOT/packages/agent-runtime/dist/index.js" "$ROOT/packages/tools/dist/index.js"; do
  if [ ! -f "$pkg" ]; then
    echo "Missing build artifact $pkg — run npm run build on server" >&2
    exit 1
  fi
done

# Self-heal broken uuid nesting (ESM uuid@14 breaks rpc-websockets CJS require)
if ! node -e "require('rpc-websockets')" >/dev/null 2>&1; then
  echo "Repairing uuid dependency for rpc-websockets..." >&2
  bash "$ROOT/scripts/fix-uuid.sh"
fi

NODE_BIN="${NODE_BIN:-$(command -v node)}"
if [ -z "$NODE_BIN" ] || [ ! -x "$NODE_BIN" ]; then
  echo "node not found in PATH" >&2
  exit 1
fi

exec "$NODE_BIN" --env-file="$ENV_FILE" "$CLI" start
