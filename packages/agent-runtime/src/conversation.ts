import type Database from "better-sqlite3";
import { getMeta } from "./db.js";
import { getIdentity } from "./identity.js";
import { callLlm, type CallLlmOptions, type ChatMessage } from "./llm.js";
import { isSimpleChatMessage, type LlmCallResult } from "./llm-router.js";
import { listMemories, searchMemories } from "./memory.js";
import {
  addCreatorMessage,
  answerCreatorMessage,
  listCreatorMessages,
  type CreatorMessageRow,
} from "./messages.js";
import { autoTitleChatThread } from "./threads.js";
import {
  buildRolePromptSection,
  type UserRole,
} from "./access.js";
import { formatTickIntervalLine } from "./tick-interval.js";
import { buildRuntimeEnvironmentBrief } from "./runtime-environment.js";
import type { RuntimeConfig, ToolDefinition } from "./types.js";
import type { ToolExecutor } from "./tick.js";

export interface ChatResult {
  id: number;
  message: string;
  response: string;
  model_label?: string;
  model?: string;
  provider?: string;
  restartRequested?: boolean;
}

export type ChatStreamEvent =
  | { type: "status"; message: string }
  | { type: "activity"; message: string }
  | { type: "model"; label: string; model: string; provider: string }
  | { type: "token"; text: string }
  | { type: "pending_send"; id: number; to: string; amount_sol: number }
  | {
      type: "done";
      response: string;
      message_id: number;
      model_label?: string;
      model?: string;
      provider?: string;
    };

interface ChatReplyWithModel {
  reply: string;
  model: LlmCallResult | null;
  restartRequested?: boolean;
}

export interface WalletSnapshot {
  pubkey: string | null;
  balanceSol: number | null;
}

const MAX_HISTORY_TURNS = 6;
const MAX_MEMORY_SNIPPETS = 4;
const MAX_MEMORY_CHARS = 120;
const MAX_TOOL_RESULT_CHARS = 1800;
const STALE_TOOL_KEEP = 3;

const PAST_CONTEXT_RE =
  /remember when|what did (we|i|you)|last time|previously|earlier|recall|about our|you said|we discussed|you told|past \d+|last \d+ (hour|day|week)|over the (past|last)/i;

/** User wants work done — not small talk. */
const TASK_REQUEST_RE =
  /\b(task tool|run_task|achieve|accomplish|implement|build |fix |deploy|install|solve|all the steps|go ahead|do this|make it so|update the|refactor|rebuild|create a|write a|set up|configure|multi.?step|without asking|keep going|use your task|get it done|take care of)\b/i;

const GREETING_ONLY_RE =
  /^(hi|hey|hello|yo|sup|thanks|thank you|ok|okay|cool|nice|good (morning|night)|what'?s up)\b[!.,?\s]*$/i;

const CONVERSATIONAL_RE =
  /^(are you okay|how are you|what do you think|what'd you think|what you mean|what do you mean|can you explain|why (are|did)|tell me about)/i;

const SYSTEM_STATE_RE =
  /tick|background|interval|how often|configured|runtime|what are you|what is your|how long|current (setting|config)|my caps|your caps/i;

function looksConversational(userMessage: string): boolean {
  const trimmed = userMessage.trim();
  if (SYSTEM_STATE_RE.test(trimmed)) return false;
  if (!trimmed || GREETING_ONLY_RE.test(trimmed)) return true;
  if (CONVERSATIONAL_RE.test(trimmed)) return true;
  if (isSimpleChatMessage(trimmed) && !TASK_REQUEST_RE.test(trimmed) && !looksLikeTaskRequest(trimmed)) {
    return true;
  }
  if (
    trimmed.length < 100 &&
    trimmed.includes("?") &&
    !TASK_REQUEST_RE.test(trimmed) &&
    !looksLikeTaskRequest(trimmed)
  ) {
    return true;
  }
  return false;
}

function buildConversationalHint(userMessage: string): string {
  if (!looksConversational(userMessage)) return "";
  if (PAST_CONTEXT_RE.test(userMessage)) {
    return [
      "Conversational recall question.",
      "You may call read_memories once, then answer in plain language.",
      "Do not chain multiple lookup tools — synthesize an answer for the user.",
    ].join(" ");
  }
  return "Conversational message: answer directly from chat history and memories in context. Skip tools unless you need live system data.";
}

function looksLikeTaskRequest(userMessage: string): boolean {
  const trimmed = userMessage.trim();
  if (!trimmed || GREETING_ONLY_RE.test(trimmed)) return false;
  if (TASK_REQUEST_RE.test(trimmed)) return true;
  return trimmed.length >= 48;
}

function buildTaskPromptSection(userMessage: string, role: UserRole): string {
  if (role !== "creative" || !looksLikeTaskRequest(userMessage)) return "";
  return [
    "TASK REQUEST: The user wants something done end-to-end.",
    "Call run_task immediately with a clear task description — it loops tools internally until complete, blocked, or timeout.",
    "Do NOT drip a few manual tool calls then stop.",
  ].join(" ");
}

function replyFromRunTask(messages: ChatMessage[]): string | null {
  const runTaskTools = messages.filter((m) => m.role === "tool" && m.name === "run_task");
  if (runTaskTools.length === 0) return null;
  return runTaskTools[runTaskTools.length - 1]!.content.trim() || null;
}

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
  config: RuntimeConfig,
  wallet: WalletSnapshot,
  userMessage: string,
  role: UserRole = "creative"
): string {
  const identity = getIdentity(db);
  const memories = memoriesForPrompt(db, userMessage);

  return [
    identity?.system_prompt ?? "You are Maximus.",
    "",
    buildRuntimeEnvironmentBrief(config),
    "",
    `User access: ${role}.`,
    buildRolePromptSection(role),
    buildTaskPromptSection(userMessage, role),
    buildConversationalHint(userMessage),
    formatTickIntervalLine(config, db),
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

function safeFallbackAfterTools(messages: ChatMessage[], userMessage: string): string {
  const memoryLines = extractMemoryLinesFromTools(messages);
  if (memoryLines.length > 0) {
    return [
      `Here's what I pulled from memory about that:`,
      memoryLines.join("\n"),
      "",
      "Ask a follow-up if you want me to dig into something specific.",
    ].join("\n");
  }

  const names = [...new Set(messages.filter((m) => m.role === "tool" && m.name).map((m) => m.name!))];
  const tools = names.length > 0 ? ` (used ${names.join(", ")})` : "";
  return `I looked into "${userMessage}"${tools} but the model didn't return a clean reply. Try asking again — I'll answer in plain language.`;
}

function extractMemoryLinesFromTools(messages: ChatMessage[]): string[] {
  const lines: string[] = [];
  for (const m of messages) {
    if (m.role !== "tool" || m.name !== "read_memories") continue;
    try {
      const rows = JSON.parse(m.content) as { content?: string; type?: string }[];
      if (!Array.isArray(rows)) continue;
      for (const row of rows.slice(0, 6)) {
        if (row.content) {
          const cap =
            row.content.length > 220 ? `${row.content.slice(0, 217)}...` : row.content;
          lines.push(`- ${row.type ? `(${row.type}) ` : ""}${cap}`);
        }
      }
    } catch {
      const snippet = m.content.trim().slice(0, 400);
      if (snippet) lines.push(`- ${snippet}`);
    }
  }
  return lines;
}

async function requestTextReplyAfterTools(
  config: RuntimeConfig,
  db: Database.Database,
  messages: ChatMessage[],
  userMessage: string
): Promise<{ text: string; model: LlmCallResult | null }> {
  const tail: ChatMessage[] = [
    ...messages,
    {
      role: "user",
      content:
        `Using the tool results above, answer the user's message in plain conversational language. ` +
        `Be direct and specific.\n\nUser message: "${userMessage}"`,
    },
  ];
  const routing: CallLlmOptions = {
    routing: { purpose: "chat", userMessage, toolStep: 0, toolsOffered: 0 },
  };
  const response = await callLlm(config, db, budgetChatMessages(tail), [], routing);
  return { text: response.content.trim(), model: response.meta ?? null };
}

async function synthesizeReply(
  config: RuntimeConfig,
  db: Database.Database,
  messages: ChatMessage[],
  userMessage: string
): Promise<string> {
  const afterTools = await requestTextReplyAfterTools(config, db, messages, userMessage);
  if (!isPlaceholderReply(afterTools.text)) return afterTools.text;
  return "";
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
  onEvent?: (event: ChatStreamEvent) => void
): Promise<ChatReplyWithModel> {
  let reply = "";
  let usedTools = false;
  let lastModel: LlmCallResult | null = null;
  let restartRequested = false;

  for (let step = 0; step < maxSteps; step++) {
    onEvent?.({ type: "activity", message: step === 0 ? "Thinking…" : `Thinking (step ${step + 1})…` });
    const routing: CallLlmOptions = {
      routing: {
        purpose: "chat",
        userMessage,
        toolStep: step,
        toolsOffered: tools.length,
      },
    };
    const response = await callLlm(config, db, budgetChatMessages(messages), tools, routing);
    if (response.meta) lastModel = response.meta;
    if (!isPlaceholderReply(response.content)) reply = response.content.trim();

    if (response.toolCalls.length === 0) break;

    usedTools = true;
    messages.push({ role: "assistant", content: response.content || "(tool calls)" });

    for (const call of response.toolCalls) {
      const toolLabel = call.name === "run_task" ? "run_task" : call.name;
      onEvent?.({ type: "activity", message: `Running ${toolLabel}…` });
      onEvent?.({ type: "status", message: `Running ${toolLabel}…` });
      try {
        const toolOut = await executeTool(call.name, call.arguments);
        if (toolOut.restartRequested) restartRequested = true;
        const preview = toolOut.result.trim().slice(0, 120).replace(/\s+/g, " ");
        if (preview) {
          onEvent?.({
            type: "activity",
            message: `${call.name}: ${preview}${toolOut.result.length > 120 ? "…" : ""}`,
          });
        }
        if (call.name === "solana_send") {
          const parsed = parsePendingSend(toolOut.result);
          if (parsed) {
            onEvent?.({
              type: "pending_send",
              id: parsed.id,
              to: parsed.to,
              amount_sol: parsed.amount,
            });
          }
        }
        messages.push({
          role: "tool",
          name: call.name,
          content: toolOut.result,
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

    const afterTools = await requestTextReplyAfterTools(config, db, messages, userMessage);
    if (afterTools.model) lastModel = afterTools.model;
    if (!isPlaceholderReply(afterTools.text)) {
      reply = afterTools.text;
      break;
    }
  }

  const runTaskReply = replyFromRunTask(messages);
  if (runTaskReply) {
    return {
      reply: runTaskReply,
      model: lastModel,
      restartRequested,
    };
  }

  if (usedTools && isPlaceholderReply(reply)) {
    const synthesized = await synthesizeReply(config, db, messages, userMessage);
    if (!isPlaceholderReply(synthesized)) reply = synthesized;
    const provider = getMeta(db, "active_llm_provider");
    const model = getMeta(db, "active_llm_model");
    const label = getMeta(db, "active_llm_label");
    if (provider && model && label) {
      lastModel = {
        provider: provider as LlmCallResult["provider"],
        model,
        label,
        attempt: Number(getMeta(db, "last_llm_attempt") ?? 1),
        fallbacksUsed: Number(getMeta(db, "last_llm_fallbacks") ?? 0),
      };
    }
  }

  if (isPlaceholderReply(reply)) {
    reply = usedTools ? safeFallbackAfterTools(messages, userMessage) : "";
  }

  if (isPlaceholderReply(reply)) {
    const routing: CallLlmOptions = { routing: { purpose: "chat", userMessage } };
    const direct = await callLlm(config, db, budgetChatMessages(messages), [], routing);
    if (direct.meta) lastModel = direct.meta;
    if (!isPlaceholderReply(direct.content)) reply = direct.content.trim();
  }

  return {
    reply: reply || "I hit a snag forming a reply — try asking again.",
    model: lastModel,
    restartRequested,
  };
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
    { role: "system", content: buildConversationPrompt(db, config, wallet, trimmed, role) },
    ...historyToMessages(history),
    { role: "user", content: trimmed },
  ];

  const routing: CallLlmOptions = { routing: { purpose: "chat", userMessage: trimmed, toolsOffered: tools.length } };

  let reply: string;
  let model: LlmCallResult | null = null;
  let restartRequested = false;

  if (tools.length > 0 && executeTool) {
    const result = await runChatWithTools(config, db, messages, tools, executeTool, trimmed);
    reply = result.reply;
    model = result.model;
    restartRequested = result.restartRequested ?? false;
  } else {
    const response = await callLlm(config, db, budgetChatMessages(messages), [], routing);
    model = response.meta ?? null;
    reply =
      response.content.trim() ||
      "I'm here. I received your message but couldn't form a reply this time.";
  }

  answerCreatorMessage(db, pending.id, reply);
  autoTitleChatThread(db, threadId, trimmed);

  return {
    id: pending.id,
    message: trimmed,
    response: reply,
    model_label: model?.label,
    model: model?.model,
    provider: model?.provider,
    restartRequested: restartRequested || undefined,
  };
}

export interface ChatGenerateResult {
  reply: string;
  model: LlmCallResult | null;
  messageId: number;
  restartRequested?: boolean;
}

function emitReplyTokens(emit: (event: ChatStreamEvent) => void, text: string): void {
  const parts = text.match(/\S+|\s+/g) ?? [text];
  for (const part of parts) {
    emit({ type: "token", text: part });
  }
}

export function streamChatReply(
  emit: (event: ChatStreamEvent) => void,
  result: ChatGenerateResult
): void {
  if (result.model) {
    emit({
      type: "model",
      label: result.model.label,
      model: result.model.model,
      provider: result.model.provider,
    });
  }
  emitReplyTokens(emit, result.reply);
  emit({
    type: "done",
    response: result.reply,
    message_id: result.messageId,
    model_label: result.model?.label,
    model: result.model?.model,
    provider: result.model?.provider,
  });
}

export async function generateCreatorChatReply(
  db: Database.Database,
  config: RuntimeConfig,
  userMessage: string,
  wallet: WalletSnapshot,
  tools: ToolDefinition[],
  executeTool: ToolExecutor,
  threadId: number,
  role: UserRole = "creative",
  onEvent?: (event: ChatStreamEvent) => void
): Promise<ChatGenerateResult> {
  const trimmed = userMessage.trim();
  const pending = addCreatorMessage(db, trimmed, "pending", threadId);
  const history = listCreatorMessages(db, MAX_HISTORY_TURNS, threadId).filter((row) => row.id !== pending.id);

  const messages: ChatMessage[] = [
    { role: "system", content: buildConversationPrompt(db, config, wallet, trimmed, role) },
    ...historyToMessages(history),
    { role: "user", content: trimmed },
  ];

  onEvent?.({ type: "status", message: "Thinking..." });

  const { reply, model, restartRequested } = await runChatWithTools(
    config,
    db,
    messages,
    tools,
    executeTool,
    trimmed,
    8,
    onEvent
  );

  answerCreatorMessage(db, pending.id, reply);
  autoTitleChatThread(db, threadId, trimmed);

  return { reply, model, messageId: pending.id, restartRequested };
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
  const result = await generateCreatorChatReply(
    db,
    config,
    userMessage,
    wallet,
    tools,
    executeTool,
    threadId,
    role,
    (event) => {
      if (event.type === "status" || event.type === "activity" || event.type === "pending_send") {
        emit(event);
      }
    }
  );
  streamChatReply(emit, result);
}
