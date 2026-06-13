# Maximus on Akash Network

Decentralized hosting — **~2 Gi RAM / 1 CPU** instead of Oracle's ~498 MB micro.

## Cost (budget)

| Item | Estimate |
|------|----------|
| Compute (2 Gi / 1 CPU, 24/7) | **~$8–10/month** (~$96–120/year) |
| Persistent storage (16 Gi total) | included in bid or +$1–2/mo |
| Escrow deposit (held, not spent) | **~$10–15 ACT** upfront |
| **Yearly total** | **~$100–150** |

Bids are marketplace-driven. Our SDL max bid is `12000 uact/block` (~$5–6/mo compute floor; real all-in often ~$8–12/mo).

## Payment: SOL vs AKT (read this)

**Maximus's Solana wallet (SOL) cannot pay Akash directly.**

| Chain | Token | What it's for |
|-------|-------|----------------|
| Solana | SOL | Maximus agent wallet, sends, staking |
| Cosmos (Akash) | AKT / ACT | Akash compute leases |

Akash bills in **ACT** (compute credit, ~$1 per ACT). You fund ACT from **AKT** in the Akash Console or Keplr/Leap wallet.

### How to fund (creator, one-time setup)

1. **Create a Cosmos wallet** — [Keplr](https://www.keplr.app/) or [Leap](https://www.leapwallet.io/), add Akash chain
2. **Buy AKT** — Kraken, Coinbase, or exchange (~$15–25 worth for first month + escrow)
3. **Withdraw AKT** to your Keplr Akash address
4. Open **[Akash Console](https://console.akash.network)** → connect wallet → **Mint ACT** from AKT
5. Deploy using `deploy/akash/maximus.yml` (see below)

### Can I just send SOL to Maximus's wallet?

**Not for Akash today.** SOL stays on Solana. To pay Akash you need AKT/ACT on Cosmos. Options:

- **You** fund Akash wallet manually (simplest, ~15 minutes once)
- **Script:** `node scripts/swap-sol-to-akt.mjs` — Jupiter (SOL→USDC) + Skip Go (USDC→AKT), no API keys. Quote first: `--quote-only`

Maximus can still **use SOL** for Solana operations (sends, staking) on either host.

## Deploy steps

### 1. Build & push Docker image

```bash
# From laptop — set your registry
export MAXIMUS_IMAGE=ghcr.io/YOUR_USER/maximus-creative:latest
./scripts/build-docker.sh
docker push "$MAXIMUS_IMAGE"
```

Or Docker Hub: `docker.io/youruser/maximus-creative:latest`

### 2. Migrate brain from Oracle (optional)

If moving from Oracle VM:

```bash
./scripts/migrate-to-akash.sh 167.234.214.140   # copies data/ + wallet/ locally
# After deploy, copy into persistent volumes via provider shell or redeploy with seeded image
```

### 3. Deploy on Akash Console

1. Go to [console.akash.network](https://console.akash.network)
2. **Create Deployment** → paste `deploy/akash/maximus.yml`
3. Replace `ghcr.io/YOUR_GITHUB_USER/maximus-creative:latest` with your image
4. Set env secrets: `LLM_API_KEY`, `GROK_API_KEY`, `WAKE_SECRET`, passwords
5. Deposit **~5–10 ACT** escrow (add more later)
6. **Choose a provider bid** — pick one with persistent storage, US/EU, ~$8–12/mo
7. Note the **public URL** (provider assigns host:port for port 80 → your 4747)

### 4. CLI deploy (optional)

```bash
# Install: https://akash.network/docs/deployments/akash-cli/installation/
export AKASH_FROM=your_keplr_address
export MAXIMUS_IMAGE=ghcr.io/you/maximus-creative:latest
./scripts/deploy-akash.sh
```

## Runtime profile

Set `MAXIMUS_RUNTIME_PROFILE=akash` in container env (default in image).

Compared to Oracle micro:

| | Oracle micro | Akash |
|--|-------------|-------|
| RAM | ~498 MB total | **2 Gi** reserved |
| Node heap | 128 MB | **768 MB** |
| Process cap | 280 MB | container limit (~2 Gi) |
| OOM freezes | frequent | rare at this size |

## Persistent volumes

| Mount | Path | Purpose |
|-------|------|---------|
| data | `/opt/maximus/data` | SQLite brain (`agent.db`) |
| wallet | `/opt/maximus/wallet` | Solana keypair |
| repo | `/opt/maximus/state` | Self-edit persistence across restarts |

## Endpoints after deploy

- Chat: `http://<provider-host>:<port>/` (port 80 mapped to 4747)
- Health: `/health`
- Status: `/status`

Update `MAXIMUS_URL` on your laptop for `./scripts/talk.sh`.

## Tear down / move

Close lease in Akash Console → escrow returns (minus spent blocks). Image + SDL redeploy anywhere.
