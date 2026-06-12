import type Database from "better-sqlite3";
import type { Keypair } from "@solana/web3.js";
import {
  getPendingSend,
  markSendFailed,
  markSendSent,
  markSendRejected,
  type RuntimeConfig,
} from "@maximus/agent-runtime";
import { sendSol } from "@maximus/tools";

export async function executeApprovedSend(
  db: Database.Database,
  config: RuntimeConfig,
  keypair: Keypair,
  id: number
): Promise<{ ok: true; signature: string } | { ok: false; error: string }> {
  const row = getPendingSend(db, id);
  if (!row) return { ok: false, error: "not found" };
  if (row.status !== "pending") return { ok: false, error: `already ${row.status}` };

  try {
    const signature = await sendSol(config, keypair, row.to_address, row.amount_sol);
    markSendSent(db, id, signature);
    return { ok: true, signature };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    markSendFailed(db, id, message);
    return { ok: false, error: message };
  }
}

export function rejectPendingSend(db: Database.Database, id: number): boolean {
  const row = getPendingSend(db, id);
  if (!row || row.status !== "pending") return false;
  markSendRejected(db, id);
  return true;
}
