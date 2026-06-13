#!/usr/bin/env bash
# Keep SSH responsive on a 1GB Oracle VM by protecting sshd from OOM and
# restarting Maximus before memory is exhausted.
# Run on server:  sudo bash /opt/maximus/scripts/harden-vm.sh
# From laptop:    ./scripts/harden-vm.sh 167.234.214.140
set -euo pipefail

if [ "${1:-}" != "" ]; then
  IP="$1"
  ssh -o ConnectTimeout=20 -o StrictHostKeyChecking=accept-new -i "$HOME/.ssh/id_ed25519" "opc@${IP}" \
    'sudo bash /opt/maximus/scripts/harden-vm.sh'
  exit 0
fi

echo "==> Ensuring swap is active..."
# Remove duplicate small swap if present — two swapfiles cause thrashing on 1GB VMs.
if swapon --show 2>/dev/null | grep -q '/\.swapfile'; then
  swapoff /.swapfile 2>/dev/null || true
  rm -f /.swapfile
fi
if ! swapon --show | grep -q /swapfile; then
  if [ ! -f /swapfile ]; then
    fallocate -l 2G /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=2048
    chmod 600 /swapfile
    mkswap /swapfile
  fi
  swapon /swapfile
  grep -q swapfile /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "==> Memory sysctl tuning..."
tee /etc/sysctl.d/99-maximus-vm.conf > /dev/null << 'SYSCTL'
# Prefer reclaiming cache before OOM; keep sshd responsive on small VMs.
vm.swappiness=60
vm.vfs_cache_pressure=150
SYSCTL
sysctl --system >/dev/null 2>&1 || sysctl -p /etc/sysctl.d/99-maximus-vm.conf >/dev/null 2>&1 || true

echo "==> Protecting sshd from OOM killer..."
SSH_UNIT=""
if systemctl status sshd.service >/dev/null 2>&1; then
  SSH_UNIT="sshd.service"
elif systemctl status ssh.service >/dev/null 2>&1; then
  SSH_UNIT="ssh.service"
fi
if [ -n "$SSH_UNIT" ]; then
  mkdir -p "/etc/systemd/system/${SSH_UNIT}.d"
  tee "/etc/systemd/system/${SSH_UNIT}.d/oom-protect.conf" > /dev/null << 'OOM'
[Service]
OOMScoreAdjust=-900
OOMPreference=avoid
OOM
  systemctl daemon-reload
  systemctl restart "$SSH_UNIT" || systemctl start "$SSH_UNIT" || true
fi

echo "==> SSH keepalive (prevents idle disconnects)..."
SSHD_CFG="/etc/ssh/sshd_config"
if [ -f "$SSHD_CFG" ]; then
  grep -q '^ClientAliveInterval' "$SSHD_CFG" \
    && sed -i 's/^ClientAliveInterval.*/ClientAliveInterval 120/' "$SSHD_CFG" \
    || echo 'ClientAliveInterval 120' >> "$SSHD_CFG"
  grep -q '^ClientAliveCountMax' "$SSHD_CFG" \
    && sed -i 's/^ClientAliveCountMax.*/ClientAliveCountMax 3/' "$SSHD_CFG" \
    || echo 'ClientAliveCountMax 3' >> "$SSHD_CFG"
  grep -q '^UseDNS' "$SSHD_CFG" \
    && sed -i 's/^UseDNS.*/UseDNS no/' "$SSHD_CFG" \
    || echo 'UseDNS no' >> "$SSHD_CFG"
  if [ -n "$SSH_UNIT" ]; then
    systemctl reload "$SSH_UNIT" 2>/dev/null || systemctl restart "$SSH_UNIT" || true
  fi
fi

echo "==> Low-memory watchdog (restarts Maximus before SSH chokes)..."
tee /usr/local/bin/maximus-watchdog.sh > /dev/null << 'WATCHDOG'
#!/bin/bash
set -euo pipefail

AVAIL_KB=$(awk '/MemAvailable:/ {print $2}' /proc/meminfo)
MEM_PCT=$(free | awk '/Mem:/ {printf "%.0f", $3/$2 * 100}')
LOAD=$(awk '{print $1}' /proc/loadavg)

# Restart Maximus when free RAM is critically low — before OOM hits sshd.
if [ -n "$AVAIL_KB" ] && [ "$AVAIL_KB" -lt 100000 ]; then
  logger -t maximus-watchdog "MemAvailable ${AVAIL_KB}KB — restarting maximus"
  systemctl restart maximus
  exit 0
fi

if [ "$MEM_PCT" -gt 88 ]; then
  logger -t maximus-watchdog "memory at ${MEM_PCT}% — restarting maximus"
  systemctl restart maximus
  exit 0
fi

# Heavy CPU load + low RAM — tick/LLM is likely wedging the box.
if [ -n "$LOAD" ] && awk -v l="$LOAD" 'BEGIN{exit !(l>3.5)}' && [ -n "$AVAIL_KB" ] && [ "$AVAIL_KB" -lt 200000 ]; then
  logger -t maximus-watchdog "load ${LOAD} with low RAM — restarting maximus"
  systemctl restart maximus
  exit 0
fi

if ! curl -sf --max-time 10 http://127.0.0.1:4747/health > /dev/null; then
  logger -t maximus-watchdog "health failed — restarting maximus"
  systemctl restart maximus
fi
WATCHDOG
chmod +x /usr/local/bin/maximus-watchdog.sh
WATCH_CRON="* * * * * /usr/local/bin/maximus-watchdog.sh"
TMP_CRON="$(mktemp)"
crontab -l 2>/dev/null | grep -v maximus-watchdog > "$TMP_CRON" || true
echo "$WATCH_CRON" >> "$TMP_CRON"
crontab "$TMP_CRON"
rm -f "$TMP_CRON"

echo "==> Tightening Maximus memory cgroup (1GB VM)..."
if [ -f /etc/systemd/system/maximus.service ]; then
  mkdir -p /etc/systemd/system/maximus.service.d
  tee /etc/systemd/system/maximus.service.d/memory.conf > /dev/null << 'MEM'
[Service]
Environment=NODE_OPTIONS=--max-old-space-size=128
MemoryHigh=240M
MemoryMax=280M
MemorySwapMax=400M
OOMScoreAdjust=900
OOMPreference=omit
Nice=15
CPUQuota=35%
MEM
  systemctl daemon-reload
fi

echo "==> VM hardening complete."
free -h | head -2
swapon --show || true
systemctl is-active sshd 2>/dev/null || systemctl is-active ssh 2>/dev/null || echo "sshd status unknown"
systemctl is-active maximus 2>/dev/null || echo "maximus not running"
