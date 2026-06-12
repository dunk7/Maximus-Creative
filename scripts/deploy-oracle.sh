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
  sed -i 's/^TICK_INTERVAL_MS=.*/TICK_INTERVAL_MS=1800000/' .env
else
  echo 'TICK_INTERVAL_MS=1800000' >> .env
fi

# Free RAM: stop Maximus and kill stray npm before install/build
sudo systemctl stop maximus 2>/dev/null || true
pkill -f 'npm install' 2>/dev/null || true
pkill -f 'npm ci' 2>/dev/null || true
sleep 2

LOCK_HASH="$(md5sum package-lock.json | awk '{print $1}')"
NEED_INSTALL=0
if [ ! -f .npm-install-hash ] || [ "$(cat .npm-install-hash)" != "$LOCK_HASH" ] || [ ! -d node_modules ]; then
  NEED_INSTALL=1
fi

if [ "$NEED_INSTALL" = "1" ]; then
  echo "Running npm install (Maximus stopped to free RAM)..."
  rm -rf node_modules/rpc-websockets/node_modules/uuid 2>/dev/null || true
  npm install --prefer-offline --no-audit --no-fund
  bash scripts/fix-uuid.sh
  echo "$LOCK_HASH" > .npm-install-hash
else
  echo "node_modules unchanged — skipping npm install"
fi

bash scripts/fix-uuid.sh
chmod +x scripts/start-maximus.sh scripts/fix-uuid.sh scripts/stabilize-vm.sh 2>/dev/null || true

npm run build --workspace=@maximus/agent-runtime
npm run build --workspace=@maximus/tools
npm run build --workspace=@maximus/core

if [ ! -f data/agent.db ]; then
  npm run genesis
fi

# Smoke-test startup imports before enabling service
node --env-file=.env -e "require('rpc-websockets'); console.log('imports ok')"

sudo tee /etc/systemd/system/maximus.service > /dev/null << 'UNIT'
[Unit]
Description=Maximus Creative autonomous core
After=network-online.target
Wants=network-online.target
StartLimitIntervalSec=120
StartLimitBurst=5

[Service]
Type=simple
User=opc
WorkingDirectory=/opt/maximus
EnvironmentFile=/opt/maximus/.env
Environment=NODE_OPTIONS=--max-old-space-size=384
ExecStart=/opt/maximus/scripts/start-maximus.sh
Restart=on-failure
RestartSec=10
TimeoutStartSec=120
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
sudo systemctl reset-failed maximus 2>/dev/null || true
sudo systemctl restart maximus

echo "Waiting for health..."
for i in $(seq 1 30); do
  if curl -sf --max-time 5 http://127.0.0.1:4747/health >/dev/null 2>&1; then
    echo "Health OK"
    curl -s --max-time 5 http://127.0.0.1:4747/health
    echo
    break
  fi
  sleep 2
done
sudo systemctl is-active maximus
curl -s --max-time 10 http://127.0.0.1:4747/health || echo "health check pending..."

sudo tee /usr/local/bin/maximus-watchdog.sh > /dev/null << 'WATCHDOG'
#!/bin/bash
set -euo pipefail

MEM_PCT=$(free | awk '/Mem:/ {printf "%.0f", $3/$2 * 100}')
if [ "$MEM_PCT" -gt 95 ]; then
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
(sudo crontab -l 2>/dev/null || true; echo "*/2 * * * * /usr/local/bin/maximus-watchdog.sh") | grep -v maximus-watchdog | sudo crontab - || true
echo "Watchdog cron installed"
REMOTE_INSTALL

echo ""
echo "==> Deploy complete!"
echo "    Chat:       http://${IP}:4747/"
echo "    Dashboard:  http://${IP}:4747/dashboard"
echo "    Status API: curl -s http://${IP}:4747/status"
echo "    Talk CLI:   ./scripts/talk.sh \"Hello Maximus\""
echo "    Logs:    ssh ${USER}@${IP} 'sudo journalctl -u maximus -f'"
echo ""
echo "If talk fails auth, fetch the server secret:"
echo "    ssh ${USER}@${IP} 'grep WAKE_SECRET /opt/maximus/.env'"
echo ""
echo "Set GitHub secrets:"
echo "    MAXIMUS_WAKE_URL=http://${IP}:4747"
echo "    MAXIMUS_WAKE_SECRET=<value from server .env WAKE_SECRET>"
