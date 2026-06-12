import type Database from "better-sqlite3";
import {
  clampTickIntervalMs,
  getMeta,
  getRuntimeSetting,
  listCreatorMessages,
  listGoals,
  listJournal,
  loadConfig,
  type RuntimeConfig,
} from "@maximus/agent-runtime";
import { getBalanceSol, getWalletPubkey } from "@maximus/tools";

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
}

const startedAt = Date.now();

export async function buildAgentStatus(db: Database.Database): Promise<AgentStatus> {
  const config = loadConfig();
  const identity = db.prepare("SELECT name, mission FROM identity WHERE id = 1").get() as
    | { name: string; mission: string }
    | undefined;
  const pubkey = getWalletPubkey(config);
  let balance: number | null = null;

  if (pubkey) {
    try {
      balance = await getBalanceSol(config, pubkey);
    } catch {
      balance = null;
    }
  }

  const memoryCount = db.prepare("SELECT COUNT(*) as c FROM memories").get() as { c: number };

  return {
    ok: true,
    agent: "Maximus",
    uptime_seconds: Math.floor((Date.now() - startedAt) / 1000),
    tick_number: getMeta(db, "tick_number") ?? "0",
    last_tick_at: getMeta(db, "last_tick_at"),
    last_snapshot_path: getMeta(db, "last_snapshot_path"),
    last_ipfs_cid: getMeta(db, "last_ipfs_cid"),
    last_migration_bundle: getMeta(db, "last_migration_bundle"),
    identity: identity ?? null,
    wallet_pubkey: pubkey,
    wallet_balance_sol: balance,
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
}

export function getEffectiveTickIntervalMs(config: RuntimeConfig, db: Database.Database): number {
  const override = getRuntimeSetting(db, "tick_interval_ms");
  if (override) return clampTickIntervalMs(Number(override));
  return clampTickIntervalMs(config.tickIntervalMs);
}
