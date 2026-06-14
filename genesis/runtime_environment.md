# Maximus Runtime Environment

This file describes where you run, what resources you have, and how to behave on this box.
Call `read_runtime_environment()` anytime for this doc plus a live memory/CPU snapshot.

## RAM — read this first

**You do NOT have 1 GB of RAM to work with.**

Oracle advertises this Always Free instance as "1 GB RAM" (`VM.Standard.E2.1.Micro`). That is the **billing label**, not what Linux gives you. Inside the VM, `MemTotal` is about **498–510 MB** (~0.5 GB). That is the **entire machine** — operating system, SSH, firewall, and you — not your private pool.

| What people say | What you actually have |
|-----------------|------------------------|
| Oracle console: "1 GB RAM" | Linux sees **~498 MB total** |
| Your process MemoryMax | **280 MB** cap (systemd) |
| Your Node.js heap cap | **128 MB** (`--max-old-space-size`) |
| Typical free while idle | **~170–260 MB** for the whole VM |

**Why the mismatch:** The hypervisor and host reserve memory; Oracle's "1 GB" shape does not map 1:1 to guest-visible RAM on these micro instances. Treat **~500 MB total** as the hard truth when planning ticks, tools, and shell commands. If you plan for 1 GB you will OOM-freeze the box and the creator must reboot the server.

The live snapshot in `read_runtime_environment()` shows current free/total — trust those numbers over any "1 GB" marketing.

## Host (production)

| Field | Value |
|-------|-------|
| Provider | Oracle Cloud Always Free |
| Region | us-sanjose-1 (update if migrated) |
| Shape | VM.Standard.E2.1.Micro (AMD x86_64) |
| **Usable RAM (Linux MemTotal)** | **~498 MB — not 1 GB** |
| Oracle advertised RAM | 1 GB (do not plan around this) |
| OCPUs | 1 |
| Swap | 2 GB `/swapfile` (survives spikes but causes slowness) |
| Public URL | http://167.234.214.140:4747/ |
| Install path | `/opt/maximus` |
| Process manager | systemd `maximus.service` |

## Resource limits (enforced)

- **systemd MemoryMax:** 280 MB for the Maximus process
- **Node heap:** `--max-old-space-size=128`
- **CPU quota:** 35% of one core
- **Tick interval:** 1 hour (`TICK_INTERVAL_MS=3600000`)
- **Boot tick delay:** 60s after start (lets SSH settle)
- **Max tool calls per autonomous tick:** 3
- **Chat `run_task` timeout:** 5 minutes default (8 max)
- **Tick timeout:** 3 minutes max
- **Low-memory tick skip:** skipped when free RAM < ~220 MB

## Why this matters

This is a **~512 MB machine**, not a 1 GB machine. The whole VM can freeze if you spike RAM or CPU — SSH becomes unresponsive and the creator must reboot from the Oracle console. A watchdog restarts you when free RAM drops below ~100 MB, but prevention is better.

## Do

- Plan every action assuming **~500 MB total system RAM**, with **280 MB max for you**
- Prefer **web_search + web_fetch** over shell for research
- Use **at most 1–2 light tools** per chat reply unless the user explicitly needs more
- Keep **autonomous ticks short** — one focused action, not exploration sprees
- Use **read_file / list_files** on `genesis/` and `apps/` before editing anything
- Take **export_snapshot** before self-modification
- Reply in chat **without tools** for greetings and simple questions
- **Creative self-mod:** `edit_file` (any path, including `.env` and `wallet/`) → `rebuild_core` → `self_restart`
- **Dependencies:** `npm install` / `npm ci` via `run_shell` (prefer `--omit=dev` on this host)
- Key UI sources: `apps/core/src/chat-page.ts`, `apps/core/src/dashboard-page.ts` (TypeScript source is in the Akash image — edit src, not dist)

## Avoid (risks, not hard blocks for creative)

- **OOM-freezing the box** — npm install, rebuild_core, and heavy compiles share ~500 MB total RAM; check free memory first
- `run_task` with many steps on this host — default 5 minutes in chat (8 max)
- `list_files` on huge trees repeatedly
- Killing your own process via shell — use **self_restart** instead
- **Thinking you have 1 GB** — you do not; see "RAM — read this first" above

## Upgrade path (creator action)

- **Akash Network (recommended):** ~2 Gi RAM, ~$8–10/mo — see `genesis/akash_deployment.md`, `deploy/akash/maximus.yml`
- Oracle **Always Free ARM** (`VM.Standard.A1.Flex`) — if available in your account

## Akash deployment

When `MAXIMUS_RUNTIME_PROFILE=akash`, you run in a Docker container on decentralized compute (~2 Gi RAM, 768 MB Node heap). Full guide: `genesis/akash_deployment.md`.

## Key paths

```
/opt/maximus/                    — repo root (production)
/opt/maximus/genesis/            — creator intent + this file
/opt/maximus/data/agent.db       — SQLite brain
/opt/maximus/wallet/agent.json   — Solana keypair
/opt/maximus/scripts/            — start, deploy, harden, stabilize
```

## Services & endpoints

- Chat UI: `/` on port **4747**
- Dashboard: `/dashboard`
- Health: `/health`
- Status API: `/status` (includes `agent_busy`, `busy_reason`)
- Wake (creative only): `POST /wake`

## Local development

When `MAXIMUS_RUNTIME_PROFILE=local`, the creator's laptop runs Maximus — more RAM, no systemd caps. Still avoid reckless shell.
