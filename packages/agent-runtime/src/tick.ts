import type Database from "better-sqlite3";
import { callLlm, type ChatMessage } from "./llm.js";
import { listGoals } from "./goals.js";
import { listJournal, writeJournal } from "./journal.js";
import { listMemories } from "./memory.js";
import { getMeta, setMeta } from "./db.js";
import type { RuntimeConfig, TickContext, TickResult } from "./types.js";
import { getIdentity } from "./identity.js";

export type ToolExecutor = (
  name: string,
  args: Record<string, unknown>
) => Promise<{ result: string; restartRequested?: boolean }>;

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
    recentMemories: listMemories(db, 15),
    recentJournal: listJournal(db, 5),
    walletPubkey,
    walletBalanceSol,
    creatorIntentAvailable: true,
  };
}

function formatContext(ctx: TickContext): string {
  const goals = ctx.goals
    .map((g) => `- [${g.id}] ${g.title} (p=${g.priority}): ${g.description}`)
    .join("\n");

  const memories = ctx.recentMemories
    .map((m) => `- (${m.type}) ${m.content}`)
    .join("\n");

  const journal = ctx.recentJournal
    .map((j) => `- tick ${j.tick_number}: ${j.content.slice(0, 300)}`)
    .join("\n");

  return [
    `Tick #${ctx.tickNumber}`,
    `Wallet: ${ctx.walletPubkey ?? "none"} | Balance: ${ctx.walletBalanceSol ?? "unknown"} SOL`,
    `Active goals:\n${goals || "(none)"}`,
    `Recent memories:\n${memories || "(none)"}`,
    `Recent journal:\n${journal || "(none)"}`,
    "Decide what to do this cycle. Use tools to think, remember, edit yourself, manage goals, interact with Solana, or run shell commands.",
  ].join("\n\n");
}

export async function runTick(
  db: Database.Database,
  config: RuntimeConfig,
  ctx: TickContext,
  toolDefinitions: import("./types.js").ToolDefinition[],
  executeTool: ToolExecutor
): Promise<TickResult> {
  const messages: ChatMessage[] = [
    { role: "system", content: ctx.identity.system_prompt },
    { role: "user", content: formatContext(ctx) },
  ];

  let totalToolCalls = 0;
  let restartRequested = false;
  let finalSummary = "";

  for (let step = 0; step < 8; step++) {
    const response = await callLlm(config, messages, toolDefinitions);
    if (response.content) finalSummary = response.content;

    if (response.toolCalls.length === 0) break;

    messages.push({ role: "assistant", content: response.content || "(tool calls)" });

    for (const call of response.toolCalls) {
      totalToolCalls += 1;
      const { result, restartRequested: restart } = await executeTool(call.name, call.arguments);
      if (restart) restartRequested = true;
      messages.push({
        role: "tool",
        name: call.name,
        content: result,
        tool_call_id: `${call.name}-${step}-${totalToolCalls}`,
      });
    }
  }

  if (!finalSummary) {
    finalSummary = totalToolCalls > 0
      ? `Completed tick #${ctx.tickNumber} with ${totalToolCalls} tool call(s).`
      : `Tick #${ctx.tickNumber} completed with no LLM actions (check LLM_API_KEY).`;
  }

  writeJournal(db, ctx.tickNumber, finalSummary);

  return {
    summary: finalSummary,
    toolCalls: totalToolCalls,
    restartRequested,
  };
}
