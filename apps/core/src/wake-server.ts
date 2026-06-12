import http from "node:http";
import {
  canApproveSol,
  canCreateThread,
  canDeleteThread,
  canViewPendingSends,
  canWake,
  createChatThread,
  deleteChatThread,
  ensureFriendThread,
  listChatThreads,
  listCreatorMessages,
  listPendingSends,
  loadConfig,
  openDatabase,
  runCreatorChat,
  generateCreatorChatReply,
  streamChatReply,
  type ChatStreamEvent,
  type ChatThreadRow,
  type ChatThreadSummary,
  type RuntimeConfig,
  type UserRole,
} from "@maximus/agent-runtime";
import { resolveAccess } from "./access-auth.js";
import { executeApprovedSend, rejectPendingSend } from "./approve-send.js";
import { CHAT_LOCK_MAX_WAIT_MS, withAgentLock } from "./agent-lock.js";
import { renderChatPage } from "./chat-page.js";
import { renderDashboardPage } from "./dashboard-page.js";
import { buildAgentStatus } from "./status.js";
import { assertThreadAccess, getThreadPassword } from "./thread-auth.js";
import { createToolExecutor, getChatToolDefinitions, loadOrCreateWallet } from "@maximus/tools";
import { loadWalletSnapshot } from "./wallet-snapshot.js";

export interface WakeServerHandlers {
  onWake: () => void;
}

const MAX_JSON_BODY_BYTES = 64 * 1024;

function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > MAX_JSON_BODY_BYTES) {
        req.destroy();
        reject(new Error("Request body too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8").trim();
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function writeSse(res: http.ServerResponse, event: ChatStreamEvent): void {
  res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
}

function isAgentBusyError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes("Agent busy");
}

async function withChatLock<T>(fn: () => Promise<T>): Promise<T> {
  return withAgentLock(fn, { maxWaitMs: CHAT_LOCK_MAX_WAIT_MS, reason: "chat" });
}

async function handleThreadChat(
  config: RuntimeConfig,
  threadId: number,
  message: string,
  role: UserRole
) {
  return withChatLock(async () => {
    const runtimeConfig = loadConfig();
    const db = openDatabase(runtimeConfig);
    const wallet = await loadWalletSnapshot(runtimeConfig);
    const keypair = loadOrCreateWallet(runtimeConfig);
    const tools = getChatToolDefinitions(db, role);
    const executeTool = createToolExecutor(db, runtimeConfig, keypair, role);
    return runCreatorChat(db, runtimeConfig, message, wallet, tools, executeTool, threadId, role);
  });
}

async function handleThreadChatStream(
  config: RuntimeConfig,
  threadId: number,
  message: string,
  role: UserRole,
  res: http.ServerResponse
): Promise<void> {
  const generated = await withChatLock(async () => {
    const runtimeConfig = loadConfig();
    const db = openDatabase(runtimeConfig);
    const wallet = await loadWalletSnapshot(runtimeConfig);
    const keypair = loadOrCreateWallet(runtimeConfig);
    const tools = getChatToolDefinitions(db, role);
    const executeTool = createToolExecutor(db, runtimeConfig, keypair, role);
    return generateCreatorChatReply(
      db,
      runtimeConfig,
      message,
      wallet,
      tools,
      executeTool,
      threadId,
      role,
      (event: ChatStreamEvent) => {
        if (event.type === "status" || event.type === "pending_send") {
          writeSse(res, event);
        }
      }
    );
  });
  streamChatReply((event: ChatStreamEvent) => writeSse(res, event), generated);
}

function threadSummary(thread: ChatThreadSummary | ChatThreadRow): ChatThreadSummary {
  if ("message_count" in thread) return thread;
  return {
    id: thread.id,
    title: thread.title,
    owner_role: thread.owner_role,
    created_at: thread.created_at,
    updated_at: thread.updated_at,
    is_locked: thread.password_hash != null,
    message_count: 0,
    preview: null,
  };
}

export function startWakeServer(
  config: RuntimeConfig,
  handlers: WakeServerHandlers
): http.Server {
  const server = http.createServer(async (req, res) => {
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };

    try {
      const path = (req.url ?? "/").split("?")[0];
      const threadRoute = path.match(/^\/threads\/(\d+)(\/messages|\/chat\/stream|\/chat)?$/);
      const pendingRoute = path.match(/^\/pending-sends\/(\d+)\/(approve|reject)$/);
      const access = resolveAccess(req, config);

      if (path === "/" || path === "/talk") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderChatPage());
        return;
      }

      if (path === "/dashboard") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderDashboardPage());
        return;
      }

      if (path === "/health") {
        json(200, { ok: true, agent: "Maximus" });
        return;
      }

      if (path === "/status") {
        const db = openDatabase(config);
        const status = await buildAgentStatus(db);
        json(200, status);
        return;
      }

      if (path === "/session" && req.method === "GET") {
        if (!access) {
          json(401, { error: "unauthorized" });
          return;
        }
        json(200, {
          role: access.role,
          label: access.label,
          capabilities: access.capabilities,
        });
        return;
      }

      if (path === "/threads" && req.method === "GET") {
        if (!access) {
          json(401, { error: "unauthorized" });
          return;
        }
        const db = openDatabase(config);
        let threads = listChatThreads(db, access.role, access.tokenHash);
        if (access.role === "friend" && threads.length === 0) {
          ensureFriendThread(db, access.token);
          threads = listChatThreads(db, access.role, access.tokenHash);
        }
        json(200, { ok: true, threads: threads.map(threadSummary) });
        return;
      }

      if (path === "/threads" && req.method === "POST") {
        if (!access) {
          json(401, { error: "unauthorized" });
          return;
        }
        if (!canCreateThread(access.role)) {
          json(403, { error: "your access level cannot create chats" });
          return;
        }
        const body = (await readJsonBody(req)) as { title?: string; password?: string };
        const db = openDatabase(config);
        const ownerRole = access.role === "family" ? "family" : "creative";
        const thread = createChatThread(
          db,
          String(body.title ?? "New chat"),
          body.password ? String(body.password) : undefined,
          ownerRole,
          access.role === "family" ? access.tokenHash : null
        );
        json(201, {
          ok: true,
          thread: threadSummary(thread),
        });
        return;
      }

      if (path === "/pending-sends" && req.method === "GET") {
        if (!access) {
          json(401, { error: "unauthorized" });
          return;
        }
        if (!canViewPendingSends(access.role)) {
          json(403, { error: "forbidden" });
          return;
        }
        const db = openDatabase(config);
        json(200, { ok: true, pending: listPendingSends(db) });
        return;
      }

      if (pendingRoute && req.method === "POST") {
        if (!access) {
          json(401, { error: "unauthorized" });
          return;
        }
        if (!canApproveSol(access.role)) {
          json(403, { error: "forbidden" });
          return;
        }
        const id = Number(pendingRoute[1]);
        const action = pendingRoute[2];
        const db = openDatabase(config);
        const runtimeConfig = loadConfig();
        const keypair = loadOrCreateWallet(runtimeConfig);

        if (action === "approve") {
          const result = await executeApprovedSend(db, runtimeConfig, keypair, id);
          json(result.ok ? 200 : 400, result);
          return;
        }

        const rejected = rejectPendingSend(db, id);
        json(rejected ? 200 : 400, { ok: rejected });
        return;
      }

      if (threadRoute) {
        const threadId = Number(threadRoute[1]);
        const sub = threadRoute[2] ?? "";

        if (!access) {
          json(401, { error: "unauthorized" });
          return;
        }

        const db = openDatabase(config);

        if (req.method === "DELETE" && !sub) {
          if (!canDeleteThread(access.role)) {
            json(403, { error: "forbidden" });
            return;
          }
          const threadAccess = assertThreadAccess(
            db,
            threadId,
            getThreadPassword(req),
            access.role,
            access.tokenHash
          );
          if (!threadAccess.ok) {
            json(threadAccess.status, { error: threadAccess.error });
            return;
          }
          const deleted = deleteChatThread(db, threadId);
          json(deleted ? 200 : 400, { ok: deleted });
          return;
        }

        const threadAccess = assertThreadAccess(
          db,
          threadId,
          getThreadPassword(req),
          access.role,
          access.tokenHash
        );
        if (!threadAccess.ok) {
          json(threadAccess.status, { error: threadAccess.error });
          return;
        }

        if ((sub === "/messages" || sub === "") && req.method === "GET") {
          json(200, { ok: true, messages: listCreatorMessages(db, 100, threadId) });
          return;
        }

        if (sub === "/chat/stream" && req.method === "POST") {
          const body = (await readJsonBody(req)) as { message?: string };
          const message = String(body.message ?? "").trim();
          if (!message) {
            json(400, { error: "message required" });
            return;
          }
          res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          });
          try {
            await handleThreadChatStream(config, threadId, message, access.role, res);
          } catch (err) {
            if (isAgentBusyError(err)) {
              writeSse(res, { type: "status", message: "busy, retry" });
              writeSse(res, { type: "done", response: "Maximus is busy — try again in a moment.", message_id: 0 });
            } else {
              const msg = err instanceof Error ? err.message : String(err);
              writeSse(res, { type: "status", message: `Error: ${msg}` });
              writeSse(res, { type: "done", response: `Error: ${msg}`, message_id: 0 });
            }
          }
          res.end();
          return;
        }

        if (sub === "/chat" && req.method === "POST") {
          const body = (await readJsonBody(req)) as { message?: string };
          const message = String(body.message ?? "").trim();
          if (!message) {
            json(400, { error: "message required" });
            return;
          }
          try {
            const result = await handleThreadChat(config, threadId, message, access.role);
            json(200, { ok: true, ...result });
          } catch (err) {
            if (isAgentBusyError(err)) {
              json(503, { error: "busy, retry" });
            } else {
              throw err;
            }
          }
          return;
        }
      }

      if (path === "/chat" && req.method === "POST") {
        if (!access) {
          json(401, { error: "unauthorized" });
          return;
        }
        const body = (await readJsonBody(req)) as { message?: string };
        const message = String(body.message ?? "").trim();
        if (!message) {
          json(400, { error: "message required" });
          return;
        }
        const db = openDatabase(config);
        const threadId =
          access.role === "friend"
            ? ensureFriendThread(db, access.token).id
            : 1;
        try {
          const result = await handleThreadChat(config, threadId, message, access.role);
          json(200, { ok: true, ...result });
        } catch (err) {
          if (isAgentBusyError(err)) {
            json(503, { error: "busy, retry" });
          } else {
            throw err;
          }
        }
        return;
      }

      if (path === "/wake" && req.method === "POST") {
        if (!access) {
          json(401, { error: "unauthorized" });
          return;
        }
        if (!canWake(access.role)) {
          json(403, { error: "forbidden" });
          return;
        }
        handlers.onWake();
        json(200, { ok: true, message: "wake accepted" });
        return;
      }

      res.writeHead(404);
      res.end("not found");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      json(500, { error: message });
    }
  });

  server.listen(config.wakePort, () => {
    console.log(`Wake server listening on :${config.wakePort}`);
  });

  return server;
}
