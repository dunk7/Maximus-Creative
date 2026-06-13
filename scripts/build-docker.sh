#!/usr/bin/env bash
# Build Maximus Docker image for Akash (or any container host).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

IMAGE="${1:-${MAXIMUS_IMAGE:-maximus-creative:latest}}"

echo "==> Building Docker image: $IMAGE"
docker build -t "$IMAGE" .

echo "==> Verifying dist artifacts inside image..."
docker run --rm --entrypoint bash "$IMAGE" -c '
  test -f apps/core/dist/cli.js
  test -f packages/agent-runtime/dist/index.js
  test -f packages/tools/dist/index.js
  node -e "require(\"rpc-websockets\")"
  echo "Image OK"
'

echo ""
echo "==> Built: $IMAGE"
echo "    Push:  docker push $IMAGE"
echo "    Then deploy via Akash Console or: ./scripts/deploy-akash.sh"
