import type Database from "better-sqlite3";
import type { MemoryRow, MemoryType } from "./types.js";

export function writeMemory(
  db: Database.Database,
  type: MemoryType,
  content: string,
  importance = 0.5,
  source = "agent"
): MemoryRow {
  const result = db
    .prepare(
      "INSERT INTO memories (type, content, importance, source) VALUES (?, ?, ?, ?)"
    )
    .run(type, content, importance, source);

  return db
    .prepare("SELECT id, type, content, importance, source, created_at FROM memories WHERE id = ?")
    .get(result.lastInsertRowid) as MemoryRow;
}

export function listMemories(db: Database.Database, limit = 20): MemoryRow[] {
  return db
    .prepare(
      "SELECT id, type, content, importance, source, created_at FROM memories ORDER BY created_at DESC LIMIT ?"
    )
    .all(limit) as MemoryRow[];
}

export function searchMemories(db: Database.Database, query: string, limit = 10): MemoryRow[] {
  const pattern = `%${query}%`;
  return db
    .prepare(
      `SELECT id, type, content, importance, source, created_at
       FROM memories
       WHERE content LIKE ?
       ORDER BY importance DESC, created_at DESC
       LIMIT ?`
    )
    .all(pattern, limit) as MemoryRow[];
}
