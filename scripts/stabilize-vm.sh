#!/usr/bin/env bash
# Free RAM on the Oracle VM and restart Maximus cleanly.
# Run ON the server:  sudo /opt/maximus/scripts/stabilize-vm.sh
# Or from laptop:     ./scripts/stabilize-vm.sh 167.234.214.140
set -euo pipefail

if [ "${1:-}" != "" ]; then
  IP="$1"
  ssh -o ConnectTimeout=15 -o StrictHostKeyChecking=no -i "$HOME/.ssh/id_ed25519" "opc@${IP}" \
    'sudo bash /opt/maximus/scripts/stabilize-vm.sh'
  exit 0
fi

echo "==> Stopping stray npm/node installs (they OOM this 1GB box)..."
pkill -f 'npm install' 2>/dev/null || true
pkill -f 'npm ci' 2>/dev/null || true
sleep 2

echo "==> Restarting Maximus..."
systemctl stop maximus 2>/dev/null || true
sleep 2
systemctl start maximus

echo "==> Waiting for health..."
for i in $(seq 1 30); do
  if curl -sf --max-time 5 http://127.0.0.1:4747/health >/dev/null 2>&1; then
    echo "Health OK"
    curl -s http://127.0.0.1:4747/health
    echo
    free -h | head -2
    systemctl is-active maximus
    exit 0
  fi
  sleep 2
done

echo "Maximus did not become healthy in 60s. Check: journalctl -u maximus -n 50" >&2
exit 1
