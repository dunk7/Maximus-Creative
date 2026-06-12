#!/usr/bin/env bash
# Recover a hung Oracle VM and redeploy Maximus safely.
# Run after rebooting the instance in Oracle Console if SSH/health hang.
set -euo pipefail

IP="${1:-167.234.214.140}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "==> Running hardened deploy to ${IP}..."
exec "$ROOT/scripts/deploy-oracle.sh" "$IP"
