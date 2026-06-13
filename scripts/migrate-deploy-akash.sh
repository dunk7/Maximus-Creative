#!/usr/bin/env bash
# Full Akash migration: seed brain, build image (via GH push), mint ACT, deploy, lease, manifest.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export PATH="$ROOT/bin:$PATH"
export AKASH_HOME="${AKASH_HOME:-$ROOT/.akash-migrate}"
export AKASH_CHAIN_ID="${AKASH_CHAIN_ID:-akashnet-2}"
export AKASH_NODE="${AKASH_NODE:-https://rpc.akashnet.net:443}"
export AKASH_KEYRING_BACKEND="${AKASH_KEYRING_BACKEND:-test}"
export AKASH_KEY_NAME="${AKASH_KEY_NAME:-maximus}"
export MAXIMUS_IMAGE="${MAXIMUS_IMAGE:-ghcr.io/dunk7/maximus-creative:latest}"
export AKASH_DEPOSIT="${AKASH_DEPOSIT:-5000000uact}"

load_env() {
  if [ -f .env ]; then
    set -a
    # shellcheck disable=SC1091
    source .env
    set +a
  fi
}

ensure_wallet() {
  if ! akash keys show "$AKASH_KEY_NAME" -a --home "$AKASH_HOME" --keyring-backend "$AKASH_KEYRING_BACKEND" &>/dev/null; then
    node scripts/create-akash-wallet.mjs >/dev/null
    local mn
    mn="$(node -e "console.log(JSON.parse(require('fs').readFileSync('wallet/akash.json','utf8')).mnemonic)")"
    printf '%s\n' "$mn" | akash keys add "$AKASH_KEY_NAME" --recover \
      --home "$AKASH_HOME" --keyring-backend "$AKASH_KEYRING_BACKEND"
  fi
  AKASH_FROM="$(akash keys show "$AKASH_KEY_NAME" -a --home "$AKASH_HOME" --keyring-backend "$AKASH_KEYRING_BACKEND")"
}

ensure_cert() {
  if [ ! -f "$AKASH_HOME/${AKASH_FROM}.pem" ]; then
    echo "==> Generating Akash client certificate..."
    akash tx cert generate client --from "$AKASH_KEY_NAME" \
      --home "$AKASH_HOME" --keyring-backend "$AKASH_KEYRING_BACKEND" \
      --node "$AKASH_NODE" --chain-id "$AKASH_CHAIN_ID" \
      --gas auto --gas-adjustment 1.5 --gas-prices 0.025uakt -y
    akash tx cert publish client --from "$AKASH_KEY_NAME" \
      --home "$AKASH_HOME" --keyring-backend "$AKASH_KEYRING_BACKEND" \
      --node "$AKASH_NODE" --chain-id "$AKASH_CHAIN_ID" \
      --gas auto --gas-adjustment 1.5 --gas-prices 0.025uakt -y || true
  fi
}

package_seed() {
  if [ ! -f data/agent.db ]; then
    echo "No local data/agent.db — Akash will run fresh genesis."
    return 0
  fi
  echo "==> Packaging migration seed..."
  mkdir -p data/migration
  local seed="$ROOT/data/migration/seed.tar.gz"
  tar -czf "$seed" -C "$ROOT" data/agent.db wallet/agent.json
  if [ -n "${MIGRATION_SEED_URL:-}" ]; then
    echo "    Using MIGRATION_SEED_URL from env"
    return 0
  fi
  echo "    Uploading seed..."
  MIGRATION_SEED_URL="$(curl -fsS -F "file=@${seed}" https://0x0.st)"
  echo "    Seed URL: $MIGRATION_SEED_URL"
  export MIGRATION_SEED_URL
}

write_sdl() {
  local out="$ROOT/deploy/akash/maximus.deploy.yml"
  load_env
  python3 - "$out" <<'PY'
import os, sys
lines = open("deploy/akash/maximus.yml").read().splitlines()
clean = [ln for ln in lines if ln.strip() and not ln.lstrip().startswith("#")]
text = "\n".join(clean) + "\n"
text = text.replace("ghcr.io/dunk7/maximus-creative:latest", os.environ.get("MAXIMUS_IMAGE", "ghcr.io/dunk7/maximus-creative:latest"))
text = text.replace("LLM_API_KEY=REPLACE_ME", f"LLM_API_KEY={os.environ.get('LLM_API_KEY', '')}")
text = text.replace("GROK_API_KEY=", f"GROK_API_KEY={os.environ.get('GROK_API_KEY', '')}")
text = text.replace("WAKE_SECRET=create", f"WAKE_SECRET={os.environ.get('WAKE_SECRET', 'create')}")
text = text.replace("FAMILY_PASSWORD=family", f"FAMILY_PASSWORD={os.environ.get('FAMILY_PASSWORD', 'family')}")
text = text.replace("FRIEND_PASSWORD=friend", f"FRIEND_PASSWORD={os.environ.get('FRIEND_PASSWORD', 'friend')}")
seed = os.environ.get("MIGRATION_SEED_URL", "")
if seed and "MIGRATION_SEED_URL" not in text:
    text = text.replace(
        "      - MAXIMUS_RUNTIME_PROFILE=akash",
        f"      - MAXIMUS_RUNTIME_PROFILE=akash\n      - MIGRATION_SEED_URL={seed}",
    )
ghcr = os.environ.get("GHCR_TOKEN", "")
if ghcr and "credentials:" not in text:
    cred = (
        "    credentials:\n"
        "      host: https://ghcr.io\n"
        "      username: dunk7\n"
        f"      password: {ghcr}\n"
    )
    text = text.replace("    expose:", cred + "    expose:", 1)
open(sys.argv[1], "w").write(text)
PY
  echo "==> SDL written: deploy/akash/maximus.deploy.yml"
}

wait_for_image() {
  echo "==> Waiting for GHCR image (max 15 min): $MAXIMUS_IMAGE"
  local i=0
  while [ "$i" -lt 30 ]; do
    local code
    code="$(curl -s -o /dev/null -w "%{http_code}" "https://ghcr.io/v2/dunk7/maximus-creative/manifests/latest" || true)"
    if [ "$code" = "200" ] || [ "$code" = "401" ]; then
      # 200 = public image ready; 401 on private repo may still be pullable with provider creds
      echo "    Image registry responded (HTTP $code)."
      sleep 60
      return 0
    fi
    i=$((i + 1))
    echo "    ...building ($i/30)"
    sleep 30
  done
  echo "Continuing — image may still be building on GitHub Actions."
}

create_deployment() {
  write_sdl
  echo "==> Creating deployment (deposit $AKASH_DEPOSIT)..."
  local result
  result="$(akash tx deployment create "$ROOT/deploy/akash/maximus.deploy.yml" \
    --from "$AKASH_KEY_NAME" \
    --home "$AKASH_HOME" --keyring-backend "$AKASH_KEYRING_BACKEND" \
    --node "$AKASH_NODE" --chain-id "$AKASH_CHAIN_ID" \
    --deposit "$AKASH_DEPOSIT" \
    --gas auto --gas-adjustment 1.5 --gas-prices 0.025uakt \
    -y --broadcast-mode sync -o json)"
  DSEQ="$(akash query deployment list --owner "$AKASH_FROM" \
      --node "$AKASH_NODE" -o json | python3 -c "
import json,sys
d=json.load(sys.stdin)
active=[x for x in d.get('deployments',[]) if x['deployment']['state']=='active']
if active:
  print(active[-1]['deployment']['id']['dseq'])
else:
  ds=[int(x['deployment']['id']['dseq']) for x in d.get('deployments',[])]
  print(max(ds) if ds else '')
")"
  echo "    DSEQ: $DSEQ"
}

wait_for_bids() {
  echo "==> Waiting for provider bids..."
  local i=0 provider=""
  while [ "$i" -lt 30 ]; do
    provider="$(akash query market bid list --owner "$AKASH_FROM" --dseq "$DSEQ" \
      --node "$AKASH_NODE" -o json 2>/dev/null | python3 -c "
import json,sys
d=json.load(sys.stdin)
bids=[b for b in d.get('bids',[]) if b.get('bid',{}).get('state')=='open']
if not bids: raise SystemExit
bids.sort(key=lambda b: float(b['bid']['price']['amount']))
print(bids[0]['bid']['id']['provider'])
" 2>/dev/null || true)"
    if [ -n "$provider" ]; then
      PROVIDER="$provider"
      echo "    Provider: $PROVIDER"
      return 0
    fi
    i=$((i + 1))
    sleep 10
  done
  echo "No bids received in time." >&2
  exit 1
}

create_lease_and_manifest() {
  echo "==> Creating lease with $PROVIDER..."
  akash tx market lease create --dseq "$DSEQ" --provider "$PROVIDER" \
    --from "$AKASH_KEY_NAME" \
    --home "$AKASH_HOME" --keyring-backend "$AKASH_KEYRING_BACKEND" \
    --node "$AKASH_NODE" --chain-id "$AKASH_CHAIN_ID" \
    --gas auto --gas-adjustment 1.5 --gas-prices 0.025uakt \
    -y --broadcast-mode sync

  echo "==> Sending manifest..."
  provider-services send-manifest "$ROOT/deploy/akash/maximus.deploy.yml" \
    --dseq "$DSEQ" --provider "$PROVIDER" \
    --from "$AKASH_KEY_NAME" \
    --home "$AKASH_HOME" --keyring-backend "$AKASH_KEYRING_BACKEND" \
    --node "$AKASH_NODE"
}

wait_for_uri() {
  echo "==> Waiting for public URI..."
  local i=0 uri=""
  while [ "$i" -lt 40 ]; do
    uri="$(provider-services lease-status --dseq "$DSEQ" --provider "$PROVIDER" \
      --from "$AKASH_KEY_NAME" \
      --home "$AKASH_HOME" --keyring-backend "$AKASH_KEYRING_BACKEND" \
      --node "$AKASH_NODE" -o json 2>/dev/null | python3 -c "
import json,sys
d=json.load(sys.stdin)
for s in d.get('services',{}).values():
  u=s.get('uris',[])
  if u: print(u[0]); raise SystemExit
" 2>/dev/null || true)"
    if [ -n "$uri" ]; then
      echo ""
      echo "========================================"
      echo "Maximus live: http://${uri}/"
      echo "DSEQ: $DSEQ  Provider: $PROVIDER"
      echo "========================================"
      mkdir -p data/migration
      cat > data/migration/akash-deploy.json <<EOF
{"dseq":"$DSEQ","provider":"$PROVIDER","uri":"http://${uri}/","image":"$MAXIMUS_IMAGE","at":"$(date -Iseconds)"}
EOF
      return 0
    fi
    i=$((i + 1))
    sleep 15
  done
  echo "Lease created but URI not ready yet. Check: provider-services lease-status --dseq $DSEQ --provider $PROVIDER"
}

main() {
  load_env
  ensure_wallet
  ensure_cert
  package_seed
  wait_for_image
  create_deployment
  wait_for_bids
  create_lease_and_manifest
  wait_for_uri
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  main "$@"
fi
