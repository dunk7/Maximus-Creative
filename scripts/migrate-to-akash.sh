#!/usr/bin/env bash
# Pull Maximus brain + wallet from Oracle VM before Akash migration.
# Usage: ./scripts/migrate-to-akash.sh [ORACLE_IP]
set -euo pipefail

IP="${1:-167.234.214.140}"
USER="${2:-opc}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SSH_OPTS=(-o ConnectTimeout=30 -i "$HOME/.ssh/id_ed25519")
BACKUP="$ROOT/data/migration/oracle-$(date +%Y%m%d-%H%M%S)"

echo "==> Backing up Oracle Maximus state from ${USER}@${IP}..."
mkdir -p "$BACKUP"

ssh "${SSH_OPTS[@]}" "${USER}@${IP}" "test -f /opt/maximus/data/agent.db" \
  || { echo "No agent.db on server — is Maximus installed?" >&2; exit 1; }

scp -r "${SSH_OPTS[@]}" "${USER}@${IP}:/opt/maximus/data/agent.db" "$BACKUP/"
scp -r "${SSH_OPTS[@]}" "${USER}@${IP}:/opt/maximus/wallet/" "$BACKUP/wallet/"

if ssh "${SSH_OPTS[@]}" "${USER}@${IP}" "test -f /opt/maximus/.env" 2>/dev/null; then
  scp "${SSH_OPTS[@]}" "${USER}@${IP}:/opt/maximus/.env" "$BACKUP/.env.oracle"
  echo "    (saved .env as $BACKUP/.env.oracle — copy keys into Akash Console env)"
fi

echo ""
echo "==> Backup saved: $BACKUP"
echo ""
echo "Next steps:"
echo "  1. ./scripts/build-docker.sh && docker push \$MAXIMUS_IMAGE"
echo "  2. Deploy deploy/akash/maximus.yml on Akash Console"
echo "  3. Seed persistent volumes with agent.db + wallet from $BACKUP"
echo "     (first deploy runs genesis if empty — for migration, copy files into volumes via provider tools or custom init image)"
