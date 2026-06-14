import type Database from "better-sqlite3";
import {
  getMeta,
  listCreatorMessages,
  listGoals,
  listJournal,
  loadConfig,
  resolveTickIntervalMs,
  type RuntimeConfig,
} from "@maximus/agent-runtime";
import { getAgentBusyState } from "./agent-lock.js";
import { loadWalletSnapshot } from "./wallet-snapshot.js";

export interface AgentStatus {
  ok: true;
  agent: string;
  uptime_seconds: number;
  tick_number: string;
  last_tick_at: string | null;
  last_snapshot_path: string | null;
  last_ipfs_cid: string | null;
  last_migration_bundle: string | null;
  identity: { name: string; mission: string } | null;
  wallet_pubkey: string | null;
  wallet_balance_sol: number | null;
  active_goals: number;
  memory_count: number;
  active_llm: {
    provider: string | null;
    model: string | null;
    label: string | null;
    at: string | null;
    fallbacks_used: string | null;
  };
  last_llm_error: string | null;
  recent_journal: ReturnType<typeof listJournal>;
  recent_messages: ReturnType<typeof listCreatorMessages>;
  agent_busy: boolean;
  busy_reason: "tick" | "chat" | null;
}

const startedAt = Date.now();
const STATUS_CACHE_MS = Number(process.env.STATUS_CACHE_MS ?? 15_000);

let statusCache: {
  at: number;
  data: Omit<AgentStatus, "uptime_seconds" | "agent_busy" | "busy_reason">;
} | null = null;

export function invalidateStatusCache(): void {
  statusCache = null;
}

export async function buildAgentStatus(
  db: Database.Database,
  options?: { fresh?: boolean }
): Promise<AgentStatus> {
  const now = Date.now();
  if (!options?.fresh && statusCache && now - statusCache.at < STATUS_CACHE_MS) {
    const busy = getAgentBusyState();
    return {
      ...statusCache.data,
      uptime_seconds: Math.floor((now - startedAt) / 1000),
      agent_busy: busy.busy,
      busy_reason: busy.reason,
    };
  }

  const config = loadConfig();
  const identity = db.prepare("SELECT name, mission FROM identity WHERE id = 1").get() as
    | { name: string; mission: string }
    | undefined;
  const wallet = await loadWalletSnapshot(config);
  const memoryCount = db.prepare("SELECT COUNT(*) as c FROM memories").get() as { c: number };

  const data: Omit<AgentStatus, "uptime_seconds" | "agent_busy" | "busy_reason"> = {
    ok: true,
    agent: "Maximus",
    tick_number: getMeta(db, "tick_number") ?? "0",
    last_tick_at: getMeta(db, "last_tick_at"),
    last_snapshot_path: getMeta(db, "last_snapshot_path"),
    last_ipfs_cid: getMeta(db, "last_ipfs_cid"),
    last_migration_bundle: getMeta(db, "last_migration_bundle"),
    identity: identity ?? null,
    wallet_pubkey: wallet.pubkey,
    wallet_balance_sol: wallet.balanceSol,
    active_goals: listGoals(db, "active").length,
    memory_count: memoryCount.c,
    active_llm: {
      provider: getMeta(db, "active_llm_provider"),
      model: getMeta(db, "active_llm_model"),
      label: getMeta(db, "active_llm_label"),
      at: getMeta(db, "active_llm_at"),
      fallbacks_used: getMeta(db, "last_llm_fallbacks"),
    },
    last_llm_error: getMeta(db, "last_llm_error"),
    recent_journal: listJournal(db, 5),
    recent_messages: listCreatorMessages(db, 5),
  };

  statusCache = { at: now, data };
  const busy = getAgentBusyState();
  return {
    ...data,
    uptime_seconds: Math.floor((now - startedAt) / 1000),
    agent_busy: busy.busy,
    busy_reason: busy.reason,
  };
}

export function getEffectiveTickIntervalMs(config: RuntimeConfig, db: Database.Database): number {
  return resolveTickIntervalMs(config, db);
}
