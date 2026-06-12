import type Database from "better-sqlite3";

export interface PendingSendRow {
  id: number;
  to_address: string;
  amount_sol: number;
  status: "pending" | "approved" | "rejected" | "sent" | "failed";
  signature: string | null;
  error: string | null;
  created_at: string;
  resolved_at: string | null;
}

export function migratePendingSends(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS pending_sends (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      to_address TEXT NOT NULL,
      amount_sol REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      signature TEXT,
      error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      resolved_at TEXT
    );
  `);
}

export function queueSolSend(
  db: Database.Database,
  toAddress: string,
  amountSol: number
): PendingSendRow {
  const result = db
    .prepare("INSERT INTO pending_sends (to_address, amount_sol) VALUES (?, ?)")
    .run(toAddress, amountSol);

  return getPendingSend(db, Number(result.lastInsertRowid))!;
}

export function getPendingSend(db: Database.Database, id: number): PendingSendRow | null {
  return (
    (db
      .prepare(
        "SELECT id, to_address, amount_sol, status, signature, error, created_at, resolved_at FROM pending_sends WHERE id = ?"
      )
      .get(id) as PendingSendRow | undefined) ?? null
  );
}

export function listPendingSends(db: Database.Database): PendingSendRow[] {
  return db
    .prepare(
      `SELECT id, to_address, amount_sol, status, signature, error, created_at, resolved_at
       FROM pending_sends WHERE status = 'pending' ORDER BY id DESC`
    )
    .all() as PendingSendRow[];
}

export function markSendSent(db: Database.Database, id: number, signature: string): void {
  db.prepare(
    "UPDATE pending_sends SET status = 'sent', signature = ?, resolved_at = datetime('now') WHERE id = ?"
  ).run(signature, id);
}

export function markSendFailed(db: Database.Database, id: number, error: string): void {
  db.prepare(
    "UPDATE pending_sends SET status = 'failed', error = ?, resolved_at = datetime('now') WHERE id = ?"
  ).run(error, id);
}

export function markSendRejected(db: Database.Database, id: number): void {
  db.prepare(
    "UPDATE pending_sends SET status = 'rejected', resolved_at = datetime('now') WHERE id = ?"
  ).run(id);
}
