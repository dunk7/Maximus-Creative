import type Database from "better-sqlite3";
import type { JournalRow } from "./types.js";

export function writeJournal(db: Database.Database, tickNumber: number, content: string): JournalRow {
  const result = db
    .prepare("INSERT INTO journal (tick_number, content) VALUES (?, ?)")
    .run(tickNumber, content);

  return db
    .prepare("SELECT id, tick_number, content, created_at FROM journal WHERE id = ?")
    .get(result.lastInsertRowid) as JournalRow;
}

export function listJournal(db: Database.Database, limit = 10): JournalRow[] {
  return db
    .prepare(
      "SELECT id, tick_number, content, created_at FROM journal ORDER BY created_at DESC LIMIT ?"
    )
    .all(limit) as JournalRow[];
}
