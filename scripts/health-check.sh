#!/usr/bin/env bash
# Exit non-zero if Maximus /health is down. For manual checks or cron monitoring.
# Usage: ./scripts/health-check.sh [HOST:PORT]
set -euo pipefail

TARGET="${1:-http://167.234.214.140:4747}"

if curl -sf --connect-timeout 5 --max-time 10 "${TARGET}/health" | grep -q '"ok"'; then
  echo "OK: ${TARGET}/health"
  exit 0
fi

echo "FAIL: ${TARGET}/health" >&2
exit 1
