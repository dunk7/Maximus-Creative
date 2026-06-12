#!/usr/bin/env bash
# Poll Oracle VM until SSH and /health respond.
set -euo pipefail

IP="${1:-167.234.214.140}"
SSH=(ssh -o ConnectTimeout=10 -o StrictHostKeyChecking=no -i "$HOME/.ssh/id_ed25519" "opc@${IP}")

echo "Checking ${IP}..."
for i in $(seq 1 60); do
  if curl -s --connect-timeout 5 --max-time 8 "http://${IP}:4747/health" 2>/dev/null | grep -q '"ok"'; then
    echo "Health OK"
    curl -s "http://${IP}:4747/health"
    echo
    exit 0
  fi
  if "${SSH[@]}" 'echo ssh-ok' 2>/dev/null; then
    echo "SSH OK (health not ready yet — run ./scripts/recover-oracle.sh)"
    exit 2
  fi
  echo "  attempt ${i}/60..."
  sleep 10
done

echo "VM still unreachable. Reboot in Oracle Console." >&2
exit 1
