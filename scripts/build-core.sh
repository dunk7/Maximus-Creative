#!/usr/bin/env bash
# Build production JS locally — never compile on the 512 MB Oracle VM.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PROFILE="${MAXIMUS_RUNTIME_PROFILE:-}"
if [ -z "$PROFILE" ] && [ -f .env ]; then
  PROFILE="$(grep -E '^MAXIMUS_RUNTIME_PROFILE=' .env | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'" || true)"
fi
if [ "$PROFILE" = "oracle-e2-micro" ]; then
  export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=96}"
  echo "==> Oracle micro profile — using conservative Node heap for compile"
else
  export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=512}"
fi

echo "==> Building @maximus/agent-runtime..."
npm run build --workspace=@maximus/agent-runtime

echo "==> Building @maximus/tools..."
npm run build --workspace=@maximus/tools

echo "==> Building @maximus/core..."
npm run build --workspace=@maximus/core

for f in \
  packages/agent-runtime/dist/index.js \
  packages/tools/dist/index.js \
  apps/core/dist/cli.js; do
  if [ ! -f "$f" ]; then
    echo "Missing build artifact: $f" >&2
    exit 1
  fi
done

echo "==> Core build OK"
