#!/usr/bin/env bash
# End-to-end Akash migration helper (run from laptop).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> 1/5 Akash wallet"
node scripts/create-akash-wallet.mjs

AKASH_ADDR="$(node -e "console.log(JSON.parse(require('fs').readFileSync('wallet/akash.json','utf8')).address)")"
echo "    Akash address: $AKASH_ADDR"

echo ""
echo "==> 2/5 SOL balance"
node --env-file=.env -e "
const { loadOrCreateWallet, getBalanceSol } = require('./packages/tools/dist/wallet.js');
const { loadConfig } = require('./packages/agent-runtime/dist/config.js');
const c = loadConfig();
const kp = loadOrCreateWallet(c);
getBalanceSol(c, kp.publicKey.toBase58()).then(b => console.log('    SOL:', b, 'pubkey:', kp.publicKey.toBase58()));
"

echo ""
echo "==> 3/5 Swap SOL → AKT (Jupiter + Skip Go — no API key)"
echo "    Quote: node scripts/swap-sol-to-akt.mjs --quote-only ${SWAP_SOL_AMOUNT:-0.15}"
if [[ "${SKIP_SOL_SWAP:-}" == "1" ]]; then
  echo "    SKIPPED (SKIP_SOL_SWAP=1) — send AKT to: $AKASH_ADDR"
else
  node scripts/swap-sol-to-akt.mjs "${SWAP_SOL_AMOUNT:-0.15}" || {
    echo "    Swap failed — quote only: node scripts/swap-sol-to-akt.mjs --quote-only 0.15"
    echo "    Or send AKT directly to: $AKASH_ADDR (~15 AKT for first month)"
  }
fi

echo ""
echo "==> 4/5 Oracle brain backup (if VM up)"
if ./scripts/migrate-to-akash.sh "${ORACLE_IP:-167.234.214.140}" 2>/dev/null; then
  echo "    Oracle backup OK"
else
  echo "    Oracle unreachable — will start fresh genesis on Akash unless you backup later"
fi

echo ""
echo "==> 5/5 Deploy on Akash"
echo "    a) Push image: GitHub Actions → 'Build Docker image' → Run workflow"
echo "       OR locally: ./scripts/build-docker.sh && docker push \$MAXIMUS_IMAGE"
echo "    b) Edit deploy/akash/maximus.yml — set your GHCR image URL"
echo "    c) https://console.akash.network → Create deployment → paste SDL"
echo "    d) Set env: LLM_API_KEY, WAKE_SECRET, etc."
echo "    e) Deposit ~10 ACT, pick provider (~\$8-10/mo)"
echo ""
echo "    Full guide: genesis/akash_deployment.md"
echo "    Akash wallet: $AKASH_ADDR"
