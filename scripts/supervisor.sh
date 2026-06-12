#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "Maximus supervisor starting in $ROOT"
while true; do
  npm run core || true
  echo "Maximus exited — restarting in 5s..."
  sleep 5
done
