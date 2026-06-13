#!/usr/bin/env bash
# Deploy Maximus to Akash Network via provider-services CLI.
# Prerequisites: akash CLI, funded wallet (ACT), pushed Docker image.
#
#   export MAXIMUS_IMAGE=ghcr.io/you/maximus-creative:latest
#   export AKASH_FROM=akash1...
#   export AKASH_DEPOSIT=10000000   # 10 ACT in uact (6 decimals) — adjust as needed
#   ./scripts/deploy-akash.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! command -v provider-services >/dev/null 2>&1 && ! command -v akash >/dev/null 2>&1; then
  echo "Akash CLI not found." >&2
  echo "Install: https://akash.network/docs/deployments/akash-cli/installation/" >&2
  echo "Or deploy manually via https://console.akash.network using deploy/akash/maximus.yml" >&2
  exit 1
fi

AKASH_BIN="$(command -v provider-services 2>/dev/null || command -v akash)"
IMAGE="${MAXIMUS_IMAGE:?Set MAXIMUS_IMAGE e.g. ghcr.io/user/maximus-creative:latest}"
FROM="${AKASH_FROM:?Set AKASH_FROM to your Akash wallet address}"
DEPOSIT="${AKASH_DEPOSIT:-10000000uact}"
SDL_SRC="$ROOT/deploy/akash/maximus.yml"
SDL_TMP="$(mktemp)"
trap 'rm -f "$SDL_TMP"' EXIT

sed "s|ghcr.io/YOUR_GITHUB_USER/maximus-creative:latest|${IMAGE}|g" "$SDL_SRC" > "$SDL_TMP"

echo "==> Creating Akash deployment..."
echo "    Image: $IMAGE"
echo "    From:  $FROM"
echo "    SDL:   deploy/akash/maximus.yml"

"$AKASH_BIN" tx deployment create "$SDL_TMP" \
  --from "$FROM" \
  --deposit "$DEPOSIT" \
  -y

echo ""
echo "==> Deployment submitted."
echo "    Open Akash Console → My Deployments → select bids → create lease"
echo "    Or: $AKASH_BIN query deployment list --owner $FROM"
echo ""
echo "See genesis/akash_deployment.md for full guide."
