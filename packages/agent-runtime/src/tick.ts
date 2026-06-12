import type Database from "better-sqlite3";
import { callLlm, type CallLlmOptions } from "./llm.js";
import { listGoals } from "./goals.js";
import { listJournal, writeJournal } from "./journal.js";
import { listMemories } from "./memory.js";
import { listPendingCreatorMessages } from "./messages.js";
import { getMeta, setMeta } from "./db.js";
import type { RuntimeConfig, TickContext, TickResult } from "./types.js";
import { getIdentity } from "./identity.js";

export type ToolExecutor = (
  name: string,
  args: Record<string, unknown>
) => Promise<{ result: string; restartRequested?: boolean }>;

const IDLE_SKIP_HOURS = Number(process.env.TICK_IDLE_SKIP_HOURS ?? 4);
const URGENT_GOAL_PRIORITY = 0.7;
const TICK_MEMORY_LIMIT = 8;
const TICK_JOURNAL_LIMIT = 3;
/** Max tool calls per autonomous tick — keeps 1GB VM responsive. */
export const MAX_TICK_TOOL_CALLS = 3;

export function getTickNumber(db: Database.Database): number {
  const current = Number(getMeta(db, "tick_number") ?? "0");
  return current;
}

export function incrementTickNumber(db: Database.Database): number {
  const next = getTickNumber(db) + 1;
  setMeta(db, "tick_number", String(next));
  setMeta(db, "last_tick_at", new Date().toISOString());
  return next;
}

export function buildTickContext(
  db: Database.Database,
  tickNumber: number,
  walletPubkey: string | null,
  walletBalanceSol: number | null
): TickContext {
  const identity = getIdentity(db);
  if (!identity) throw new Error("Identity not initialized");

  return {
    tickNumber,
    identity,
    goals: listGoals(db, "active"),
    recentMemories: listMemories(db, TICK_MEMORY_LIMIT),
    recentJournal: listJournal(db, TICK_JOURNAL_LIMIT),
    pendingCreatorMessages: listPendingCreatorMessages(db),
    walletPubkey,
    walletBalanceSol,
    creatorIntentAvailable: true,
  };
}

/** True when the last journal entry shows no meaningful work (safe to skip LLM). */
export function isRoutineJournalEntry(content: string): boolean {
  const c = content.trim().toLowerCase();
  if (!c) return true;
  if (c.includes("tick skipped") || c.includes("low memory skip")) return true;
  if (c.includes("idle") || c.includes("check llm_api_key")) return true;
  if (/^tick #\d+: (idle|run_shell|remember\(|add_goal\()/.test(c)) return true;
  if (/^tick #\d+: .+ \+\d+ more$/.test(c)) return false;
  if (/^tick #\d+:/.test(c) && c.length < 80) return true;
  return false;
}

/** Skip LLM when idle: no pending messages, no urgent goals, routine journal, recent tick. */
export function shouldSkipIdleTick(ctx: TickContext, lastTickAt: string | null, forceRun = false): boolean {
  if (forceRun) return false;
  if (ctx.pendingCreatorMessages.length > 0) return false;
  if (ctx.goals.some((g) => g.priority >= URGENT_GOAL_PRIORITY)) return false;
  if (!lastTickAt) return false;

  const lastJournal = ctx.recentJournal[0]?.content;
  if (lastJournal && !isRoutineJournalEntry(lastJournal)) return false;

  const hoursSince = (Date.now() - new Date(lastTickAt).getTime()) / (1000 * 60 * 60);
  return hoursSince < IDLE_SKIP_HOURS;
}

function truncate(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 3)}...`;
}

function briefToolLabel(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case "write_memory":
      return `remember(${String(args.type ?? "memory")})`;
    case "add_goal":
      return `add_goal(${truncate(String(args.title ?? "goal"), 24)})`;
    case "update_goal":
      return `update_goal(#${args.id ?? "?"})`;
    case "read_file":
    case "edit_file": {
      const file = String(args.path ?? "").split("/").pop() ?? "file";
      return `${name}(${truncate(file, 20)})`;
    }
    case "run_shell":
      return "run_shell";
    case "run_task":
      return `run_task(${truncate(String(args.task ?? "task"), 20)})`;
    default:
      return name;
  }
}

function isPlaceholderSummary(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return !normalized || normalized === "(tool calls)" || normalized === "(no content)";
}

function looksLikeInsight(text: string): boolean {
  const t = text.trim();
  if (t.length < 12) return false;
  if (/^(tick #\d+:|remember\(|add_goal\(|run_shell)/i.test(t)) return false;
  return true;
}

function buildTickSummary(
  tickNumber: number,
  toolLabels: string[],
  llmContent: string
): string {
  if (looksLikeInsight(llmContent)) {
    return truncate(llmContent, 200);
  }

  if (toolLabels.length === 0) {
    return `Tick #${tickNumber}: idle`;
  }

  const unique = [...new Set(toolLabels)];
  if (unique.length <= 2) {
    return `Tick #${tickNumber}: ${unique.join(", ")}`;
  }

  return `Tick #${tickNumber}: ${unique.slice(0, 2).join(", ")} +${unique.length - 2} more`;
}

function formatContext(ctx: TickContext): string {
  const goals = ctx.goals
    .slice(0, 6)
    .map((g) => `- [${g.id}] ${g.title} (p=${g.priority})`)
    .join("\n");

  const memories = ctx.recentMemories
    .map((m) => `- (${m.type}) ${truncate(m.content, 80)}`)
    .join("\n");

  const journal = ctx.recentJournal
    .map((j) => `- #${j.tick_number}: ${truncate(j.content, 120)}`)
    .join("\n");

  const creatorMessages = ctx.pendingCreatorMessages
    .map((m) => `- [id=${m.id}] ${truncate(m.content, 200)}`)
    .join("\n");

  const parts = [
    `Tick #${ctx.tickNumber}`,
    `Wallet: ${ctx.walletBalanceSol != null ? `${ctx.walletBalanceSol.toFixed(4)} SOL` : "unknown"} (${ctx.walletPubkey ?? "none"})`,
    `Goals:\n${goals || "(none)"}`,
    memories ? `Memories:\n${memories}` : "",
    journal ? `Journal:\n${journal}` : "",
  ].filter(Boolean);

  if (creatorMessages) {
    parts.push(
      `Creator messages:\n${creatorMessages}`,
      "Address creator messages. Use tools if needed, then reply in plain language."
    );
  } else {
    parts.push(
      "Decide what to do this cycle. End with a one-sentence insight (action or decision) — not a tool list."
    );
  }

  return parts.join("\n\n");
}

export interface RunTickOptions {
  /** Cap tool calls per tick (autonomous mode). Chat passes undefined. */
  maxToolCalls?: number;
}

export async function runTick(
  db: Database.Database,
  config: RuntimeConfig,
  ctx: TickContext,
  toolDefinitions: import("./types.js").ToolDefinition[],
  executeTool: ToolExecutor,
  options: RunTickOptions = {}
): Promise<TickResult> {
  const { maxToolCalls } = options;
  const messages: import("./llm.js").ChatMessage[] = [
    { role: "system", content: ctx.identity.system_prompt },
    { role: "user", content: formatContext(ctx) },
  ];

  let totalToolCalls = 0;
  let restartRequested = false;
  let llmSummary = "";
  const toolLabels: string[] = [];
  const tickRouting: CallLlmOptions = { routing: { purpose: "tick", toolsOffered: toolDefinitions.length } };

  for (let step = 0; step < 8; step++) {
    const response = await callLlm(config, db, messages, toolDefinitions, {
      routing: { ...tickRouting.routing!, toolStep: step },
    });
    if (response.content && !isPlaceholderSummary(response.content)) {
      llmSummary = response.content;
    }

    if (response.toolCalls.length === 0) break;

    messages.push({ role: "assistant", content: response.content || "(tool calls)" });

    for (const call of response.toolCalls) {
      if (maxToolCalls != null && totalToolCalls >= maxToolCalls) {
        console.warn(`[Tick #${ctx.tickNumber}] tool budget exceeded (${maxToolCalls}), stopping`);
        break;
      }
      totalToolCalls += 1;
      toolLabels.push(briefToolLabel(call.name, call.arguments));
      const { result, restartRequested: restart } = await executeTool(call.name, call.arguments);
      if (restart) restartRequested = true;
      messages.push({
        role: "tool",
        name: call.name,
        content: truncate(result, 800),
        tool_call_id: `${call.name}-${step}-${totalToolCalls}`,
      });
    }
    if (maxToolCalls != null && totalToolCalls >= maxToolCalls) break;
  }

  const finalSummary =
    totalToolCalls === 0 && isPlaceholderSummary(llmSummary)
      ? `Tick #${ctx.tickNumber}: idle (check LLM_API_KEY)`
      : buildTickSummary(ctx.tickNumber, toolLabels, llmSummary);

  writeJournal(db, ctx.tickNumber, finalSummary);

  const replyText = !isPlaceholderSummary(llmSummary) ? llmSummary.trim() : finalSummary;

  return {
    summary: finalSummary,
    toolCalls: totalToolCalls,
    restartRequested,
    replyText,
  };
}
