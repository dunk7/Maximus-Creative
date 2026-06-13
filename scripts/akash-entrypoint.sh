#!/usr/bin/env bash
# Container entrypoint — write .env from injected env vars, run genesis once, start Maximus.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

write_env() {
  cat > .env <<EOF
LLM_AUTO=${LLM_AUTO:-true}
LLM_PROVIDER=${LLM_PROVIDER:-google}
LLM_API_KEY=${LLM_API_KEY:-}
GROK_API_KEY=${GROK_API_KEY:-}
OPENAI_API_KEY=${OPENAI_API_KEY:-}
ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY:-}
LLM_MODEL=${LLM_MODEL:-}
DATABASE_PATH=./data/agent.db
AGENT_WALLET_PATH=./wallet/agent.json
TICK_INTERVAL_MS=${TICK_INTERVAL_MS:-1800000}
BOOT_TICK_DELAY_MS=${BOOT_TICK_DELAY_MS:-60000}
WAKE_PORT=${WAKE_PORT:-4747}
WAKE_SECRET=${WAKE_SECRET:-create}
FAMILY_PASSWORD=${FAMILY_PASSWORD:-family}
FRIEND_PASSWORD=${FRIEND_PASSWORD:-friend}
SOLANA_RPC_URL=${SOLANA_RPC_URL:-https://api.mainnet-beta.solana.com}
WEB3_STORAGE_TOKEN=${WEB3_STORAGE_TOKEN:-}
MAXIMUS_RUNTIME_PROFILE=${MAXIMUS_RUNTIME_PROFILE:-akash}
MAXIMUS_STATUS_URL=${MAXIMUS_STATUS_URL:-http://127.0.0.1:4747/status}
EOF
}

write_env
bash scripts/fix-uuid.sh

if [ -n "${MIGRATION_SEED_URL:-}" ] && [ ! -f data/agent.db ]; then
  echo "==> Restoring brain from migration seed..."
  mkdir -p data wallet
  curl -fsSL "$MIGRATION_SEED_URL" -o /tmp/maximus-seed.tar.gz
  tar -xzf /tmp/maximus-seed.tar.gz -C "$ROOT"
  rm -f /tmp/maximus-seed.tar.gz
  echo "    Restored data/agent.db + wallet/"
fi

CLI="$ROOT/apps/core/dist/cli.js"
if [ ! -f data/agent.db ]; then
  echo "==> First boot — running genesis..."
  node --env-file=.env "$CLI" genesis
fi

export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=768}"
exec bash scripts/start-maximus.sh
