#!/usr/bin/env bash
# Deploy Maximus to Oracle Cloud VM. Run from your laptop:
#   ./scripts/deploy-oracle.sh 167.234.214.140
set -euo pipefail

IP="${1:?Usage: ./scripts/deploy-oracle.sh <PUBLIC_IP>}"
USER="${2:-opc}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SSH_OPTS=(-o ConnectTimeout=30 -o StrictHostKeyChecking=accept-new -i "$HOME/.ssh/id_ed25519")

echo "==> Testing SSH to ${USER}@${IP}..."
ssh "${SSH_OPTS[@]}" "${USER}@${IP}" "echo connected && uname -a"

echo "==> Bootstrap server (swap, node tarball, firewall)..."
ssh "${SSH_OPTS[@]}" "${USER}@${IP}" 'bash -s' << 'REMOTE_BOOT'
set -euo pipefail
if ! swapon --show | grep -q /swapfile; then
  sudo fallocate -l 2G /swapfile || sudo dd if=/dev/zero of=/swapfile bs=1M count=2048
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  grep -q swapfile /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
fi
if ! command -v node &>/dev/null; then
  NODE_VER=20.18.0
  curl -fsSL "https://nodejs.org/dist/v${NODE_VER}/node-v${NODE_VER}-linux-x64.tar.xz" -o /tmp/node.tar.xz
  sudo tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1
fi
sudo systemctl enable firewalld 2>/dev/null || true
sudo systemctl start firewalld 2>/dev/null || true
sudo firewall-cmd --permanent --add-port=22/tcp 2>/dev/null || true
sudo firewall-cmd --permanent --add-port=4747/tcp 2>/dev/null || true
sudo firewall-cmd --reload 2>/dev/null || true
sudo mkdir -p /opt/maximus
sudo chown opc:opc /opt/maximus
node -v
REMOTE_BOOT

echo "==> Syncing Maximus to /opt/maximus..."
rsync -avz --delete \
  -e "ssh ${SSH_OPTS[*]}" \
  --exclude node_modules \
  --exclude dist \
  --exclude .git \
  --exclude data \
  --exclude 'apps/web/.next' \
  "${ROOT}/" "${USER}@${IP}:/opt/maximus/"

echo "==> Copying .env and wallet (secrets)..."
scp "${SSH_OPTS[@]}" "${ROOT}/.env" "${USER}@${IP}:/opt/maximus/.env"
scp -r "${SSH_OPTS[@]}" "${ROOT}/wallet" "${USER}@${IP}:/opt/maximus/"

echo "==> Install, build packages, install systemd service..."
ssh "${SSH_OPTS[@]}" "${USER}@${IP}" 'bash -s' << 'REMOTE_INSTALL'
set -euo pipefail
cd /opt/maximus
export NODE_OPTIONS="--max-old-space-size=384"

if ! grep -q '^WAKE_SECRET=' .env 2>/dev/null; then
  echo 'WAKE_SECRET=create' >> .env
fi
if ! grep -q '^FAMILY_PASSWORD=' .env 2>/dev/null; then
  echo 'FAMILY_PASSWORD=family' >> .env
fi
if ! grep -q '^FRIEND_PASSWORD=' .env 2>/dev/null; then
  echo 'FRIEND_PASSWORD=friend' >> .env
fi
# Always clamp tick interval on 1GB VM — prevents API/CPU meltdown
if grep -q '^TICK_INTERVAL_MS=' .env 2>/dev/null; then
  sed -i 's/^TICK_INTERVAL_MS=.*/TICK_INTERVAL_MS=3600000/' .env
else
  echo 'TICK_INTERVAL_MS=3600000' >> .env
fi

npm install
npm run build --workspace=@maximus/agent-runtime
npm run build --workspace=@maximus/tools
npm run build --workspace=@maximus/core

if [ ! -f data/agent.db ]; then
  npm run genesis
fi

sudo tee /etc/systemd/system/maximus.service > /dev/null << 'UNIT'
[Unit]
Description=Maximus Creative autonomous core
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=opc
WorkingDirectory=/opt/maximus
EnvironmentFile=/opt/maximus/.env
Environment=NODE_OPTIONS=--max-old-space-size=384
ExecStart=/usr/local/bin/npm run core
Restart=always
RestartSec=5
TimeoutStopSec=30
Nice=15
IOSchedulingClass=idle
CPUQuota=50%
MemoryMax=768M
MemoryHigh=640M
OOMScoreAdjust=500

[Install]
WantedBy=multi-user.target
UNIT

sudo systemctl daemon-reload
sudo systemctl enable maximus
sudo systemctl restart maximus
sleep 15
sudo systemctl is-active maximus
curl -s --max-time 20 http://127.0.0.1:4747/health || echo "health check pending..."

sudo tee /usr/local/bin/maximus-watchdog.sh > /dev/null << 'WATCHDOG'
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
WATCHDOG
sudo chmod +x /usr/local/bin/maximus-watchdog.sh
(sudo crontab -l 2>/dev/null || true; echo "*/2 * * * * /usr/local/bin/maximus-watchdog.sh") | grep -v maximus-watchdog | sudo crontab -
echo "Watchdog cron installed"
REMOTE_INSTALL

echo ""
echo "==> Deploy complete!"
echo "    Talk:    ./scripts/talk.sh \"Hello Maximus\""
echo "    Status:  curl -s http://${IP}:4747/status"
echo "    Logs:    ssh ${USER}@${IP} 'sudo journalctl -u maximus -f'"
echo ""
echo "If talk fails auth, fetch the server secret:"
echo "    ssh ${USER}@${IP} 'grep WAKE_SECRET /opt/maximus/.env'"
echo ""
echo "Set GitHub secrets:"
echo "    MAXIMUS_WAKE_URL=http://${IP}:4747"
echo "    MAXIMUS_WAKE_SECRET=<value from server .env WAKE_SECRET>"
