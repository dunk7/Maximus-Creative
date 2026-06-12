# Maximus Creative

Autonomous, self-modifying AI core with Solana wallet and perpetual tick loop.

## Quick start

```bash
cd "/home/max/Projects/Maximus Creative"
cp .env.example .env
# Add LLM_API_KEY to .env

npm install
npm run build
npm run genesis   # once
# Send 1 SOL to the printed wallet pubkey
npm run core      # or ./scripts/supervisor.sh for auto-restart
```

## LLM auto mode (recommended)

Set in `.env`:

```
LLM_AUTO=true
LLM_API_KEY=your-google-key
GROK_API_KEY=xai-your-key-from-console.x.ai
OPENAI_API_KEY=optional-backup
ANTHROPIC_API_KEY=optional-backup
```

Fallback order: **Google → Grok → OpenAI → Anthropic → offline mode**

Get a Grok key: [console.x.ai](https://console.x.ai/) → API Keys → create key (starts with `xai-`).

Maximus will:
1. Query Google's API for available models
2. Pick the smartest one (3.5 Pro → 3.5 Flash → 3.1 Pro → …)
3. Fall through backup models if one fails
4. Fall through OpenAI / Anthropic if you added those keys
5. Stay alive in offline mode if everything fails — never crash the tick loop

Check active model: `npm run status --workspace=@maximus/core`

## Commands

| Command | Description |
|---------|-------------|
| `npm run genesis` | Seal creator intent, create identity, generate wallet |
| `npm run core` | Start immortal tick loop + wake server |
| `npm run tick-once --workspace=@maximus/core` | Run a single tick |
| `npm run status --workspace=@maximus/core` | Print status JSON |
| `npm run web --workspace=@maximus/web` | Start status web UI on :3000 |
| `./scripts/supervisor.sh` | Auto-restart loop after self_restart |

## Wake endpoints (port 4747)

- `GET /health` — liveness
- `GET /status` — full agent status JSON
- `GET /messages` — conversation history (`Authorization: Bearer $WAKE_SECRET`)
- `POST /chat` — talk to Maximus, get an immediate reply (`Authorization: Bearer $WAKE_SECRET`, body `{"message":"..."}`)
- `POST /message` — queue a message for the next tick (uses tools)
- `POST /wake` — trigger immediate tick (`Authorization: Bearer $WAKE_SECRET`)

### Talk from your laptop

```bash
./scripts/talk.sh "Hello Maximus, what are you working on?"
./scripts/talk.sh --history
```

Or:

```bash
curl -X POST http://167.234.214.140:4747/chat \
  -H "Authorization: Bearer $WAKE_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"message":"Hello Maximus"}'
```

## Backup wake

GitHub Actions workflow at `.github/workflows/wake.yml` pings `/wake` every 15 minutes when you set repo secrets:

- `MAXIMUS_WAKE_URL` — e.g. `http://your-host:4747`
- `MAXIMUS_WAKE_SECRET` — same as `WAKE_SECRET` in `.env`

## Tools available to Maximus

- Memory: `write_memory`, `read_memories`, `delete_memory`, `consolidate_memories`
- Goals: `list_goals`, `add_goal`, `update_goal`
- Self-edit: `read_file`, `edit_file`, `list_files`, `edit_prompt`, `edit_config`, `create_tool`, `self_restart`
- Shell/git/web: `run_shell`, `git_status`, `git_commit`, `web_fetch`
- Solana: `solana_balance`, `solana_send`, `solana_stake`, `solana_stake_accounts`
- Survival: `export_snapshot`, `list_snapshots`, `self_deploy`, `read_creator_intent`

## Optional IPFS pinning

Set `WEB3_STORAGE_TOKEN` in `.env` and Maximus can pin snapshots via `export_snapshot` with `pin_ipfs: true`.

## Creator intent

Sealed at genesis from `genesis/creator_intent.md`. Maximus can re-read it anytime via `read_creator_intent`.
