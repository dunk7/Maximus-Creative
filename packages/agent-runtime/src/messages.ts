import type Database from "better-sqlite3";
import { touchChatThread } from "./threads.js";

export interface CreatorMessageRow {
  id: number;
  thread_id: number;
  content: string;
  response: string | null;
  status: "pending" | "answered";
  tick_number: number | null;
  created_at: string;
  responded_at: string | null;
}

export function addCreatorMessage(
  db: Database.Database,
  content: string,
  status: CreatorMessageRow["status"] = "pending",
  threadId = 1
): CreatorMessageRow {
  const result = db
    .prepare("INSERT INTO creator_messages (content, status, thread_id) VALUES (?, ?, ?)")
    .run(content.trim(), status, threadId);

  touchChatThread(db, threadId);

  return db
    .prepare(
      `SELECT id, thread_id, content, response, status, tick_number, created_at, responded_at
       FROM creator_messages WHERE id = ?`
    )
    .get(result.lastInsertRowid) as CreatorMessageRow;
}

export function answerCreatorMessage(
  db: Database.Database,
  id: number,
  response: string,
  tickNumber?: number
): CreatorMessageRow | null {
  const existing = getCreatorMessage(db, id);
  db.prepare(
    `UPDATE creator_messages
     SET response = ?, status = 'answered', responded_at = datetime('now'), tick_number = COALESCE(?, tick_number)
     WHERE id = ?`
  ).run(response, tickNumber ?? null, id);

  if (existing) touchChatThread(db, existing.thread_id);
  return getCreatorMessage(db, id);
}

export function getCreatorMessage(db: Database.Database, id: number): CreatorMessageRow | null {
  return (
    (db
      .prepare(
        `SELECT id, thread_id, content, response, status, tick_number, created_at, responded_at
         FROM creator_messages WHERE id = ?`
      )
      .get(id) as CreatorMessageRow | undefined) ?? null
  );
}

export function listPendingCreatorMessages(db: Database.Database): CreatorMessageRow[] {
  return db
    .prepare(
      `SELECT id, thread_id, content, response, status, tick_number, created_at, responded_at
       FROM creator_messages
       WHERE status = 'pending'
       ORDER BY id ASC`
    )
    .all() as CreatorMessageRow[];
}

export function listCreatorMessages(
  db: Database.Database,
  limit = 20,
  threadId?: number
): CreatorMessageRow[] {
  if (threadId != null) {
    return db
      .prepare(
        `SELECT id, thread_id, content, response, status, tick_number, created_at, responded_at
         FROM creator_messages
         WHERE thread_id = ?
         ORDER BY id DESC
         LIMIT ?`
      )
      .all(threadId, limit) as CreatorMessageRow[];
  }

  return db
    .prepare(
      `SELECT id, thread_id, content, response, status, tick_number, created_at, responded_at
       FROM creator_messages
       ORDER BY id DESC
       LIMIT ?`
    )
    .all(limit) as CreatorMessageRow[];
}
