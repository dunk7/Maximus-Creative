#!/usr/bin/env bash
# Setup HTTPS with Caddy on Oracle VM. Requires a domain pointing to the VM IP.
# Usage: DOMAIN=chat.example.com ./scripts/setup-https.sh 167.234.214.140
set -euo pipefail

IP="${1:?Usage: DOMAIN=your.domain ./scripts/setup-https.sh <IP>}"
DOMAIN="${DOMAIN:?Set DOMAIN=your.domain.com}"

ssh -o StrictHostKeyChecking=no -i "$HOME/.ssh/id_ed25519" "opc@${IP}" "bash -s" <<REMOTE
set -euo pipefail
sudo dnf install -y caddy 2>/dev/null || {
  sudo dnf install -y 'dnf-command(copr)' || true
  sudo dnf copr enable -y @caddy/caddy 2>/dev/null || true
  sudo dnf install -y caddy
}

sudo tee /etc/caddy/Caddyfile > /dev/null <<CADDY
${DOMAIN} {
  reverse_proxy 127.0.0.1:4747
}
CADDY

sudo systemctl enable caddy
sudo systemctl restart caddy
echo "HTTPS live at https://${DOMAIN}"
REMOTE

echo "Open Oracle security list: allow TCP 80 and 443"
