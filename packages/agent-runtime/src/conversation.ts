import type Database from "better-sqlite3";
import { getIdentity } from "./identity.js";
import { callLlm, type CallLlmOptions, type ChatMessage } from "./llm.js";
import { listMemories, searchMemories } from "./memory.js";
import {
  addCreatorMessage,
  answerCreatorMessage,
  listCreatorMessages,
  type CreatorMessageRow,
} from "./messages.js";
import { autoTitleChatThread } from "./threads.js";
import { buildRolePromptSection, type UserRole } from "./access.js";
import type { RuntimeConfig, ToolDefinition } from "./types.js";
import type { ToolExecutor } from "./tick.js";

export interface ChatResult {
  id: number;
  message: string;
  response: string;
}

export type ChatStreamEvent =
  | { type: "status"; message: string }
  | { type: "token"; text: string }
  | { type: "pending_send"; id: number; to: string; amount_sol: number }
  | { type: "done"; response: string; message_id: number };

export interface WalletSnapshot {
  pubkey: string | null;
  balanceSol: number | null;
}

const MAX_HISTORY_TURNS = 6;
const MAX_MEMORY_SNIPPETS = 4;
const MAX_MEMORY_CHARS = 120;
const MAX_TOOL_RESULT_CHARS = 400;
const STALE_TOOL_KEEP = 2;

const PAST_CONTEXT_RE =
  /remember when|what did (we|i|you)|last time|previously|earlier|recall|about our|you said|we discussed|you told/i;

function formatWalletLine(wallet: WalletSnapshot): string {
  if (!wallet.pubkey) return "Wallet: not loaded.";
  const balance =
    wallet.balanceSol != null ? `${wallet.balanceSol.toFixed(6)} SOL` : "balance unknown (RPC error)";
  return `Live wallet: ${balance} | ${wallet.pubkey}`;
}

function memoriesForPrompt(db: Database.Database, userMessage: string): string {
  const cap = (content: string) =>
    content.length > MAX_MEMORY_CHARS ? `${content.slice(0, MAX_MEMORY_CHARS - 3)}...` : content;

  if (PAST_CONTEXT_RE.test(userMessage)) {
    const hits = searchMemories(db, userMessage.slice(0, 80), MAX_MEMORY_SNIPPETS);
    if (hits.length > 0) {
      return hits.map((m) => `- (${m.type}) ${cap(m.content)}`).join("\n");
    }
  }

  return listMemories(db, MAX_MEMORY_SNIPPETS)
    .map((m) => `- (${m.type}) ${cap(m.content)}`)
    .join("\n");
}

function buildConversationPrompt(
  db: Database.Database,
  wallet: WalletSnapshot,
  userMessage: string,
  role: UserRole = "creative"
): string {
  const identity = getIdentity(db);
  const memories = memoriesForPrompt(db, userMessage);

  return [
    identity?.system_prompt ?? "You are Maximus.",
    "",
    `User access: ${role}.`,
    buildRolePromptSection(role),
    formatWalletLine(wallet),
    memories ? `Recent memories (may be stale — use read_memories for recall):\n${memories}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function isPlaceholderReply(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return (
    !normalized ||
    normalized === "(tool calls)" ||
    normalized === "(no content)" ||
    normalized === "got it." ||
    normalized === "got it"
  );
}

function historyToMessages(rows: CreatorMessageRow[]): ChatMessage[] {
  const chronological = [...rows].reverse();
  const messages: ChatMessage[] = [];

  for (const row of chronological) {
    if (row.status !== "answered" || !row.response) continue;
    if (isPlaceholderReply(row.response) || row.response.trim() === "Got it.") continue;
    messages.push({ role: "user", content: row.content });
    messages.push({ role: "assistant", content: row.response });
  }

  return messages.slice(-MAX_HISTORY_TURNS * 2);
}

function budgetChatMessages(messages: ChatMessage[]): ChatMessage[] {
  const toolIndices = messages
    .map((m, i) => (m.role === "tool" ? i : -1))
    .filter((i) => i >= 0);
  const keepFull = new Set(toolIndices.slice(-STALE_TOOL_KEEP));

  return messages.map((m, i) => {
    if (m.role !== "tool") return m;
    if (keepFull.has(i) && m.content.length <= MAX_TOOL_RESULT_CHARS) return m;
    const prefix = keepFull.has(i) ? "" : "[truncated] ";
    const truncated = m.content.slice(0, MAX_TOOL_RESULT_CHARS);
    return {
      ...m,
      content: prefix + truncated + (m.content.length > MAX_TOOL_RESULT_CHARS ? "…" : ""),
    };
  });
}

export async function fetchWalletSnapshot(
  getBalance: (pubkey: string) => Promise<number>,
  pubkey: string | null
): Promise<WalletSnapshot> {
  if (!pubkey) return { pubkey: null, balanceSol: null };
  try {
    return { pubkey, balanceSol: await getBalance(pubkey) };
  } catch {
    return { pubkey, balanceSol: null };
  }
}

function summarizeFromToolResults(messages: ChatMessage[]): string | null {
  const toolMessages = messages.filter((m) => m.role === "tool");
  if (toolMessages.length === 0) return null;
  const last = toolMessages[toolMessages.length - 1]!;
  const snippet = last.content.trim().slice(0, 600);
  return snippet ? `Here's what I found: ${snippet}` : null;
}

async function synthesizeReply(
  config: RuntimeConfig,
  db: Database.Database,
  messages: ChatMessage[],
  userMessage: string
): Promise<string> {
  messages.push({
    role: "user",
    content:
      "Now reply to the user in plain language. Summarize any tool results. Do not call more tools.",
  });
  const routing: CallLlmOptions = {
    routing: { purpose: "synthesis", userMessage },
  };
  const final = await callLlm(config, db, messages, [], routing);
  return final.content.trim();
}

function parsePendingSend(toolResult: string): { id: number; to: string; amount: number } | null {
  const match = toolResult.match(/queued \(#(\d+)\): ([\d.]+) SOL → (\S+)/);
  if (!match) return null;
  return { id: Number(match[1]), amount: Number(match[2]), to: match[3]! };
}

async function runChatWithTools(
  config: RuntimeConfig,
  db: Database.Database,
  messages: ChatMessage[],
  tools: ToolDefinition[],
  executeTool: ToolExecutor,
  userMessage: string,
  maxSteps = 8,
  onTool?: (name: string, result: string) => void
): Promise<string> {
  let reply = "";
  let usedTools = false;

  for (let step = 0; step < maxSteps; step++) {
    const routing: CallLlmOptions = {
      routing: {
        purpose: "chat",
        userMessage,
        toolStep: step,
        toolsOffered: tools.length,
      },
    };
    const response = await callLlm(config, db, budgetChatMessages(messages), tools, routing);
    if (!isPlaceholderReply(response.content)) reply = response.content.trim();

    if (response.toolCalls.length === 0) break;

    usedTools = true;
    messages.push({ role: "assistant", content: response.content || "(tool calls)" });

    for (const call of response.toolCalls) {
      try {
        const { result } = await executeTool(call.name, call.arguments);
        onTool?.(call.name, result);
        messages.push({
          role: "tool",
          name: call.name,
          content: result,
          tool_call_id: `${call.name}-${step}-${call.name}`,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        messages.push({
          role: "tool",
          name: call.name,
          content: `Tool error: ${message}`,
          tool_call_id: `${call.name}-${step}-error`,
        });
      }
    }
  }

  if (usedTools || isPlaceholderReply(reply)) {
    const synthesized = await synthesizeReply(config, db, messages, userMessage);
    if (!isPlaceholderReply(synthesized)) reply = synthesized;
  }

  if (isPlaceholderReply(reply)) {
    reply = summarizeFromToolResults(messages) ?? "";
  }

  if (isPlaceholderReply(reply)) {
    const routing: CallLlmOptions = { routing: { purpose: "chat", userMessage } };
    const direct = await callLlm(config, db, budgetChatMessages(messages), [], routing);
    if (!isPlaceholderReply(direct.content)) reply = direct.content.trim();
  }

  return reply || "I hit a snag forming a reply — try asking again.";
}

export async function runCreatorChat(
  db: Database.Database,
  config: RuntimeConfig,
  userMessage: string,
  wallet: WalletSnapshot = { pubkey: null, balanceSol: null },
  tools: ToolDefinition[] = [],
  executeTool?: ToolExecutor,
  threadId = 1,
  role: UserRole = "creative"
): Promise<ChatResult> {
  const trimmed = userMessage.trim();
  if (!trimmed) throw new Error("Message cannot be empty");

  const pending = addCreatorMessage(db, trimmed, "pending", threadId);
  const history = listCreatorMessages(db, MAX_HISTORY_TURNS, threadId).filter((row) => row.id !== pending.id);

  const messages: ChatMessage[] = [
    { role: "system", content: buildConversationPrompt(db, wallet, trimmed, role) },
    ...historyToMessages(history),
    { role: "user", content: trimmed },
  ];

  const routing: CallLlmOptions = { routing: { purpose: "chat", userMessage: trimmed, toolsOffered: tools.length } };

  const reply =
    tools.length > 0 && executeTool
      ? await runChatWithTools(config, db, messages, tools, executeTool, trimmed)
      : (
          await callLlm(config, db, budgetChatMessages(messages), [], routing)
        ).content.trim() ||
        "I'm here. I received your message but couldn't form a reply this time.";

  answerCreatorMessage(db, pending.id, reply);
  autoTitleChatThread(db, threadId, trimmed);

  return {
    id: pending.id,
    message: trimmed,
    response: reply,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function emitReplyTokens(
  emit: (event: ChatStreamEvent) => void,
  text: string
): Promise<void> {
  const parts = text.match(/\S+|\s+/g) ?? [text];
  for (const part of parts) {
    emit({ type: "token", text: part });
    if (part.trim()) await sleep(18);
  }
}

export async function runCreatorChatStream(
  db: Database.Database,
  config: RuntimeConfig,
  userMessage: string,
  wallet: WalletSnapshot,
  tools: ToolDefinition[],
  executeTool: ToolExecutor,
  threadId: number,
  emit: (event: ChatStreamEvent) => void,
  role: UserRole = "creative"
): Promise<void> {
  const trimmed = userMessage.trim();
  const pending = addCreatorMessage(db, trimmed, "pending", threadId);
  const history = listCreatorMessages(db, MAX_HISTORY_TURNS, threadId).filter((row) => row.id !== pending.id);

  const messages: ChatMessage[] = [
    { role: "system", content: buildConversationPrompt(db, wallet, trimmed, role) },
    ...historyToMessages(history),
    { role: "user", content: trimmed },
  ];

  emit({ type: "status", message: "Thinking..." });

  const reply = await runChatWithTools(config, db, messages, tools, executeTool, trimmed, 8, (name, result) => {
    emit({ type: "status", message: `Running ${name}...` });
    if (name === "solana_send") {
      const parsed = parsePendingSend(result);
      if (parsed) {
        emit({
          type: "pending_send",
          id: parsed.id,
          to: parsed.to,
          amount_sol: parsed.amount,
        });
      }
    }
  });

  await emitReplyTokens(emit, reply);
  answerCreatorMessage(db, pending.id, reply);
  autoTitleChatThread(db, threadId, trimmed);
  emit({ type: "done", response: reply, message_id: pending.id });
}
