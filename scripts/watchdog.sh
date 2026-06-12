#!/usr/bin/env bash
# Install health + memory watchdog on Oracle VM — restarts maximus if /health fails or RAM >90%.
# Usage: ./scripts/watchdog.sh 167.234.214.140
set -euo pipefail

IP="${1:?Usage: ./scripts/watchdog.sh <IP>}"

ssh -o StrictHostKeyChecking=no -i "$HOME/.ssh/id_ed25519" "opc@${IP}" 'bash -s' <<'REMOTE'
set -euo pipefail
sudo tee /usr/local/bin/maximus-watchdog.sh > /dev/null <<'SCRIPT'
#!/bin/bash
set -euo pipefail

MEM_PCT=$(free | awk '/Mem:/ {printf "%.0f", $3/$2 * 100}')
if [ "$MEM_PCT" -gt 90 ]; then
  logger -t maximus-watchdog "memory at ${MEM_PCT}% — restarting maximus"
  sudo systemctl restart maximus
  exit 0
fi

if ! curl -sf --max-time 10 http://127.0.0.1:4747/health > /dev/null; then
  logger -t maximus-watchdog "health failed — restarting maximus"
  sudo systemctl restart maximus
fi
SCRIPT
sudo chmod +x /usr/local/bin/maximus-watchdog.sh
(sudo crontab -l 2>/dev/null || true; echo "*/2 * * * * /usr/local/bin/maximus-watchdog.sh") | grep -v maximus-watchdog | sudo crontab -
echo "Watchdog installed (health + memory, every 2 min)"
REMOTE
