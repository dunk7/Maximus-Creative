import crypto from "node:crypto";
import type Database from "better-sqlite3";
import {
  canViewThread,
  hashAccessToken,
  type ThreadOwnerRole,
  type UserRole,
} from "./access.js";

export interface ChatThreadRow {
  id: number;
  title: string;
  password_hash: string | null;
  owner_role: ThreadOwnerRole;
  owner_token_hash: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChatThreadSummary extends Omit<ChatThreadRow, "password_hash" | "owner_token_hash"> {
  is_locked: boolean;
  message_count: number;
  preview: string | null;
}

export function hashThreadPassword(password: string): string {
  return crypto.createHash("sha256").update(password).digest("hex");
}

export function verifyThreadPassword(
  passwordHash: string | null,
  password: string | undefined
): boolean {
  if (!passwordHash) return true;
  if (!password) return false;
  return hashThreadPassword(password) === passwordHash;
}

export function migrateChatThreads(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_threads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL DEFAULT 'General',
      password_hash TEXT,
      owner_role TEXT NOT NULL DEFAULT 'creative',
      owner_token_hash TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const threadColumns = db.prepare("PRAGMA table_info(chat_threads)").all() as { name: string }[];
  if (!threadColumns.some((col) => col.name === "owner_role")) {
    db.exec("ALTER TABLE chat_threads ADD COLUMN owner_role TEXT NOT NULL DEFAULT 'creative'");
  }
  if (!threadColumns.some((col) => col.name === "owner_token_hash")) {
    db.exec("ALTER TABLE chat_threads ADD COLUMN owner_token_hash TEXT");
  }

  const columns = db.prepare("PRAGMA table_info(creator_messages)").all() as { name: string }[];
  if (!columns.some((col) => col.name === "thread_id")) {
    db.exec("ALTER TABLE creator_messages ADD COLUMN thread_id INTEGER REFERENCES chat_threads(id)");
  }

  const count = db.prepare("SELECT COUNT(*) as c FROM chat_threads").get() as { c: number };
  if (count.c === 0) {
    db.prepare(
      "INSERT INTO chat_threads (id, title, owner_role) VALUES (1, 'General', 'creative')"
    ).run();
  } else {
    db.prepare("UPDATE chat_threads SET owner_role = 'creative' WHERE owner_role IS NULL").run();
    db.prepare("UPDATE chat_threads SET owner_role = 'creative' WHERE id = 1").run();
  }

  db.prepare("UPDATE creator_messages SET thread_id = 1 WHERE thread_id IS NULL").run();
}

export function createChatThread(
  db: Database.Database,
  title: string,
  password?: string,
  ownerRole: ThreadOwnerRole = "creative",
  ownerTokenHash: string | null = null
): ChatThreadRow {
  const trimmedTitle = title.trim() || "New chat";
  const passwordHash = password?.trim() ? hashThreadPassword(password.trim()) : null;

  const result = db
    .prepare(
      "INSERT INTO chat_threads (title, password_hash, owner_role, owner_token_hash) VALUES (?, ?, ?, ?)"
    )
    .run(trimmedTitle, passwordHash, ownerRole, ownerTokenHash);

  return getChatThread(db, Number(result.lastInsertRowid))!;
}

export function ensureFriendThread(
  db: Database.Database,
  accessToken: string
): ChatThreadRow {
  const tokenHash = hashAccessToken(accessToken);
  const existing = db
    .prepare(
      `SELECT id, title, password_hash, owner_role, owner_token_hash, created_at, updated_at
       FROM chat_threads
       WHERE owner_role = 'friend' AND owner_token_hash = ?
       ORDER BY id ASC
       LIMIT 1`
    )
    .get(tokenHash) as ChatThreadRow | undefined;

  if (existing) return existing;

  return createChatThread(db, "Chat", undefined, "friend", tokenHash);
}

export function getChatThread(db: Database.Database, id: number): ChatThreadRow | null {
  return (
    (db
      .prepare(
        `SELECT id, title, password_hash, owner_role, owner_token_hash, created_at, updated_at
         FROM chat_threads WHERE id = ?`
      )
      .get(id) as ChatThreadRow | undefined) ?? null
  );
}

export function touchChatThread(db: Database.Database, id: number): void {
  db.prepare("UPDATE chat_threads SET updated_at = datetime('now') WHERE id = ?").run(id);
}

export function renameChatThread(db: Database.Database, id: number, title: string): void {
  const trimmed = title.trim().slice(0, 80);
  if (!trimmed) return;
  db.prepare("UPDATE chat_threads SET title = ?, updated_at = datetime('now') WHERE id = ?").run(
    trimmed,
    id
  );
}

export function autoTitleChatThread(
  db: Database.Database,
  threadId: number,
  firstMessage: string
): void {
  const thread = getChatThread(db, threadId);
  if (!thread) return;
  if (!/^(New chat|General|Chat)$/i.test(thread.title)) return;
  const title = firstMessage.trim().replace(/\s+/g, " ").slice(0, 48);
  if (title.length >= 4) renameChatThread(db, threadId, title);
}

export function deleteChatThread(db: Database.Database, id: number): boolean {
  if (id === 1) return false;
  db.prepare("DELETE FROM creator_messages WHERE thread_id = ?").run(id);
  const result = db.prepare("DELETE FROM chat_threads WHERE id = ?").run(id);
  return result.changes > 0;
}

export function listChatThreads(
  db: Database.Database,
  viewerRole: UserRole = "creative",
  viewerTokenHash: string | null = null
): ChatThreadSummary[] {
  const rows = db
    .prepare(
      `SELECT t.id, t.title, t.password_hash, t.owner_role, t.owner_token_hash,
              t.created_at, t.updated_at,
              COUNT(m.id) as message_count,
              (SELECT content FROM creator_messages WHERE thread_id = t.id ORDER BY id DESC LIMIT 1) as preview
       FROM chat_threads t
       LEFT JOIN creator_messages m ON m.thread_id = t.id
       GROUP BY t.id
       ORDER BY t.updated_at DESC`
    )
    .all() as Array<
      ChatThreadRow & { message_count: number; preview: string | null }
    >;

  return rows
    .filter((row) =>
      canViewThread(viewerRole, row.owner_role, row.owner_token_hash, viewerTokenHash)
    )
    .map((row) => ({
      id: row.id,
      title: row.title,
      owner_role: row.owner_role,
      created_at: row.created_at,
      updated_at: row.updated_at,
      is_locked: row.password_hash != null,
      message_count: row.message_count,
      preview: row.password_hash ? null : (row.preview?.slice(0, 80) ?? null),
    }));
}
