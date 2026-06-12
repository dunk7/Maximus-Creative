# Maximus Creative

Autonomous, self-modifying AI core with a Solana wallet and perpetual tick loop.

## Quick start

```bash
cd "/home/max/Projects/Maximus Creative"
cp .env.example .env
# Add LLM_API_KEY to .env

npm install
npm run genesis
# Send 1 SOL to the printed wallet pubkey
npm run core
```

## Commands

| Command | Description |
|---------|-------------|
| `npm run genesis` | Seal creator intent, create identity, generate wallet |
| `npm run core` | Start immortal tick loop + wake server |
| `npm run tick-once --workspace=@maximus/core` | Run a single tick |
| `npm run status --workspace=@maximus/core` | Print status JSON |

## Wake endpoints

- `GET /health` on port 4747
- `POST /wake` with `Authorization: Bearer $WAKE_SECRET`

## Creator intent

Sealed at genesis from `genesis/creator_intent.md` into `data/genesis/creator_intent.original`.
Maximus can always call `read_creator_intent` to re-read your message.
