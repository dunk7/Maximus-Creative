import type http from "node:http";
import type Database from "better-sqlite3";
import {
  canViewThread,
  getChatThread,
  verifyThreadPassword,
  type UserRole,
} from "@maximus/agent-runtime";

export function getThreadPassword(req: http.IncomingMessage): string | undefined {
  const header = req.headers["x-thread-password"];
  if (typeof header === "string" && header.trim()) return header.trim();
  return undefined;
}

export function assertThreadAccess(
  db: Database.Database,
  threadId: number,
  threadPassword: string | undefined,
  viewerRole: UserRole = "creative",
  viewerTokenHash: string | null = null
): { ok: true } | { ok: false; status: number; error: string } {
  const thread = getChatThread(db, threadId);
  if (!thread) return { ok: false, status: 404, error: "thread not found" };

  if (!canViewThread(viewerRole, thread.owner_role, thread.owner_token_hash, viewerTokenHash)) {
    return { ok: false, status: 403, error: "thread not visible at your access level" };
  }

  if (!verifyThreadPassword(thread.password_hash, threadPassword)) {
    return { ok: false, status: 403, error: "thread password required" };
  }
  return { ok: true };
}
