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

echo "==> Building on laptop (not on the VM)..."
bash "$ROOT/scripts/build-core.sh"

echo "==> Syncing Maximus to /opt/maximus..."
rsync -avz --delete \
  -e "ssh ${SSH_OPTS[*]}" \
  --exclude node_modules \
  --exclude .git \
  --exclude data \
  --exclude 'apps/web/.next' \
  --exclude 'apps/web/node_modules' \
  "${ROOT}/" "${USER}@${IP}:/opt/maximus/"

echo "==> Copying .env and wallet (secrets)..."
scp "${SSH_OPTS[@]}" "${ROOT}/.env" "${USER}@${IP}:/opt/maximus/.env"
scp -r "${SSH_OPTS[@]}" "${ROOT}/wallet" "${USER}@${IP}:/opt/maximus/"

echo "==> Install runtime deps only (no compile on VM)..."
ssh "${SSH_OPTS[@]}" "${USER}@${IP}" 'bash -s' << 'REMOTE_INSTALL'
set -euo pipefail
cd /opt/maximus
export NODE_OPTIONS="--max-old-space-size=128"
export npm_config_audit=false
export npm_config_fund=false
export npm_config_progress=false

if ! grep -q '^WAKE_SECRET=' .env 2>/dev/null; then
  echo 'WAKE_SECRET=create' >> .env
fi
if ! grep -q '^FAMILY_PASSWORD=' .env 2>/dev/null; then
  echo 'FAMILY_PASSWORD=family' >> .env
fi
if ! grep -q '^FRIEND_PASSWORD=' .env 2>/dev/null; then
  echo 'FRIEND_PASSWORD=friend' >> .env
fi
if grep -q '^TICK_INTERVAL_MS=' .env 2>/dev/null; then
  sed -i 's/^TICK_INTERVAL_MS=.*/TICK_INTERVAL_MS=1800000/' .env
else
  echo 'TICK_INTERVAL_MS=1800000' >> .env
fi
if ! grep -q '^BOOT_TICK_DELAY_MS=' .env 2>/dev/null; then
  echo 'BOOT_TICK_DELAY_MS=60000' >> .env
fi
if ! grep -q '^MAXIMUS_RUNTIME_PROFILE=' .env 2>/dev/null; then
  echo 'MAXIMUS_RUNTIME_PROFILE=oracle-e2-micro' >> .env
fi

for f in \
  apps/core/dist/cli.js \
  packages/agent-runtime/dist/index.js \
  packages/tools/dist/index.js; do
  if [ ! -f "$f" ]; then
    echo "Missing $f — run npm run build:core on your laptop before deploy" >&2
    exit 1
  fi
done

sudo systemctl stop maximus 2>/dev/null || true
pkill -f 'npm install' 2>/dev/null || true
pkill -f 'npm ci' 2>/dev/null || true
sleep 2

cp -f .npmrc.production .npmrc

LOCK_HASH="$(md5sum package-lock.json | awk '{print $1}')"
NEED_INSTALL=0
if [ ! -f .npm-install-hash ] || [ "$(cat .npm-install-hash)" != "$LOCK_HASH" ] || [ ! -d node_modules ]; then
  NEED_INSTALL=1
fi

if [ "$NEED_INSTALL" = "1" ]; then
  echo "Running production npm install (core workspaces only, no devDeps)..."
  rm -rf node_modules/rpc-websockets/node_modules/uuid 2>/dev/null || true
  npm install --omit=dev --prefer-offline --no-audit --no-fund \
    --workspace=@maximus/agent-runtime \
    --workspace=@maximus/tools \
    --workspace=@maximus/core
  bash scripts/fix-uuid.sh
  echo "$LOCK_HASH" > .npm-install-hash
else
  echo "node_modules unchanged — skipping npm install"
fi

bash scripts/fix-uuid.sh
chmod +x scripts/start-maximus.sh scripts/fix-uuid.sh scripts/stabilize-vm.sh scripts/harden-vm.sh scripts/build-core.sh 2>/dev/null || true

# Drop dev tooling if it slipped in — saves RAM on tiny VM
rm -rf node_modules/typescript node_modules/tsx node_modules/next node_modules/@next 2>/dev/null || true

if [ ! -f data/agent.db ]; then
  node --env-file=.env apps/core/dist/cli.js genesis
fi

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
Environment=NODE_OPTIONS=--max-old-space-size=128
ExecStart=/opt/maximus/scripts/start-maximus.sh
Restart=on-failure
RestartSec=10
TimeoutStartSec=120
TimeoutStopSec=30
Nice=15
IOSchedulingClass=idle
CPUQuota=35%
MemoryHigh=240M
MemoryMax=280M
MemorySwapMax=400M
OOMScoreAdjust=900
OOMPreference=omit

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

sudo bash scripts/harden-vm.sh
echo "VM hardening applied"
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
