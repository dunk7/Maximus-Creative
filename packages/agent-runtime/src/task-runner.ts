import type Database from "better-sqlite3";
import { setMeta } from "./db.js";
import { readCreatorIntent } from "./genesis.js";
import { listGoals } from "./goals.js";
import { getIdentity } from "./identity.js";
import { callLlm, type CallLlmOptions, type ChatMessage } from "./llm.js";
import { writeMemory } from "./memory.js";
import type { RuntimeConfig, ToolDefinition } from "./types.js";
import type { ToolExecutor } from "./tick.js";

export type TaskRunStatus =
  | "completed"
  | "blocked"
  | "timeout"
  | "step_limit"
  | "substep_timeout"
  | "error";

export interface RunTaskOptions {
  task: string;
  tools: ToolDefinition[];
  executeTool: ToolExecutor;
  goalId?: number;
  maxSteps?: number;
  maxWallMs?: number;
  subStepTimeoutMs?: number;
  onProgress?: (message: string) => void;
}

export interface RunTaskResult {
  status: TaskRunStatus;
  summary: string;
  stepsTaken: number;
  toolCalls: number;
  toolsUsed: string[];
  elapsedMs: number;
  restartRequested?: boolean;
}

const DEFAULT_MAX_STEPS = 40;
const DEFAULT_MAX_WALL_MS = 8 * 60 * 1000;
const DEFAULT_SUBSTEP_TIMEOUT_MS = 3 * 60 * 1000;
const MAX_TOOL_RESULT_CHARS = 1200;
const TASK_EXCLUDED_TOOLS = new Set(["run_task"]);

const TASK_SYSTEM_SUFFIX = `
TASK EXECUTION MODE — work autonomously until done.

- Use tools to make real progress. Do not stop after planning — execute.
- Break the work into substeps and finish each one.
- When the task is fully complete, respond with ONLY this JSON (no markdown):
  {"status":"complete","summary":"Concrete recap: files changed, commands run, what was fixed or built — not step counts."}
- If truly blocked (needs human input, missing credentials, impossible on this VM), respond with ONLY:
  {"status":"blocked","summary":"Why blocked, what you tried, and what is needed to continue."}
- Otherwise keep calling tools. Do not ask the user to say "keep going".`;

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 3)}...`;
}

function parseTaskStatus(text: string): { status: "complete" | "blocked"; summary: string } | null {
  const trimmed = text.trim();
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;

  try {
    const parsed = JSON.parse(jsonMatch[0]) as { status?: string; summary?: string };
    if (parsed.status === "complete" || parsed.status === "blocked") {
      return {
        status: parsed.status,
        summary: String(parsed.summary ?? "No summary provided.").slice(0, 3000),
      };
    }
  } catch {
    return null;
  }
  return null;
}

function buildTaskPrompt(db: Database.Database, task: string, goalId?: number): string {
  const identity = getIdentity(db);
  const goals = listGoals(db, "active")
    .slice(0, 8)
    .map((g) => `- [${g.id}] ${g.title} (p=${g.priority}): ${g.description}`)
    .join("\n");

  let creatorIntent = "";
  try {
    creatorIntent = truncate(readCreatorIntent(db), 2000);
  } catch {
    creatorIntent = "(not sealed)";
  }

  const goalLine =
    goalId != null ? `\nLinked goal id: ${goalId}` : "";

  return [
    identity?.system_prompt ?? "You are Maximus.",
    TASK_SYSTEM_SUFFIX,
    "",
    `Mission: ${identity?.mission ?? "Grow capability over long horizons."}`,
    "",
    `Creator intent (excerpt):\n${creatorIntent}`,
    "",
    `Active goals:\n${goals || "(none)"}`,
    goalLine,
    "",
    `TASK TO COMPLETE:\n${task}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function filterTaskTools(tools: ToolDefinition[]): ToolDefinition[] {
  return tools.filter((t) => !TASK_EXCLUDED_TOOLS.has(t.name));
}

export async function runAutonomousTask(
  config: RuntimeConfig,
  db: Database.Database,
  options: RunTaskOptions
): Promise<RunTaskResult> {
  const {
    task,
    tools,
    executeTool,
    goalId,
    maxSteps = DEFAULT_MAX_STEPS,
    maxWallMs = DEFAULT_MAX_WALL_MS,
    subStepTimeoutMs = DEFAULT_SUBSTEP_TIMEOUT_MS,
    onProgress,
  } = options;

  const startedAt = Date.now();
  const taskTools = filterTaskTools(tools);
  const toolsUsed: string[] = [];
  let stepsTaken = 0;
  let toolCalls = 0;
  let restartRequested = false;
  let lastSummary = "";
  let slowSubSteps = 0;

  const messages: ChatMessage[] = [
    { role: "system", content: buildTaskPrompt(db, task, goalId) },
    { role: "user", content: "Begin the task now. Use tools until it is fully done." },
  ];

  const routingBase: CallLlmOptions = { routing: { purpose: "task", toolsOffered: taskTools.length } };

  try {
    for (let step = 0; step < maxSteps; step++) {
      if (Date.now() - startedAt > maxWallMs) {
        return finalizeTask(db, task, {
          status: "timeout",
          summary: `Task timed out after ${Math.round(maxWallMs / 60000)} minutes. Last progress: ${lastSummary || "none"}`,
          stepsTaken,
          toolCalls,
          toolsUsed,
          elapsedMs: Date.now() - startedAt,
          restartRequested,
        });
      }

      const stepStart = Date.now();
      onProgress?.(`Step ${step + 1}: thinking...`);

      const response = await callLlm(config, db, messages, taskTools, {
        routing: { ...routingBase.routing!, toolStep: step },
      });

      if (response.content.trim()) {
        lastSummary = response.content.trim();
      }

      if (response.toolCalls.length === 0) {
        const verdict = parseTaskStatus(response.content);
        if (verdict?.status === "complete") {
          return finalizeTask(db, task, {
            status: "completed",
            summary: verdict.summary,
            stepsTaken,
            toolCalls,
            toolsUsed,
            elapsedMs: Date.now() - startedAt,
            restartRequested,
          });
        }
        if (verdict?.status === "blocked") {
          return finalizeTask(db, task, {
            status: "blocked",
            summary: verdict.summary,
            stepsTaken,
            toolCalls,
            toolsUsed,
            elapsedMs: Date.now() - startedAt,
            restartRequested,
          });
        }

        messages.push({ role: "assistant", content: response.content || "(stopped)" });
        messages.push({
          role: "user",
          content:
            "You stopped without declaring complete or blocked. Continue working — call tools to make progress, or reply with the complete/blocked JSON when truly done.",
        });
        stepsTaken += 1;
        continue;
      }

      messages.push({ role: "assistant", content: response.content || "(tool calls)" });

      for (const call of response.toolCalls) {
        onProgress?.(`Running ${call.name}...`);
        toolsUsed.push(call.name);
        toolCalls += 1;

        const { result, restartRequested: restart } = await executeTool(call.name, call.arguments);
        if (restart) restartRequested = true;

        messages.push({
          role: "tool",
          name: call.name,
          content: truncate(result, MAX_TOOL_RESULT_CHARS),
          tool_call_id: `task-${step}-${call.name}-${toolCalls}`,
        });

        if (Date.now() - startedAt > maxWallMs) {
          return finalizeTask(db, task, {
            status: "timeout",
            summary: `Task timed out after ${Math.round(maxWallMs / 60000)} minutes. Last progress: ${lastSummary || "none"}`,
            stepsTaken: stepsTaken + 1,
            toolCalls,
            toolsUsed,
            elapsedMs: Date.now() - startedAt,
            restartRequested,
          });
        }
      }

      stepsTaken += 1;
      const stepElapsed = Date.now() - stepStart;
      if (stepElapsed > subStepTimeoutMs) {
        slowSubSteps += 1;
        onProgress?.(`Substep slow (${Math.round(stepElapsed / 1000)}s)`);
        if (slowSubSteps >= 2) {
          return finalizeTask(db, task, {
            status: "substep_timeout",
            summary: `Substep exceeded ${Math.round(subStepTimeoutMs / 60000)} min twice. Last progress: ${lastSummary || "none"}`,
            stepsTaken,
            toolCalls,
            toolsUsed,
            elapsedMs: Date.now() - startedAt,
            restartRequested,
          });
        }
      } else {
        slowSubSteps = 0;
      }
    }

    return finalizeTask(db, task, {
      status: "step_limit",
      summary: `Hit step limit (${maxSteps}). Last progress: ${lastSummary || "none"}`,
      stepsTaken,
      toolCalls,
      toolsUsed,
      elapsedMs: Date.now() - startedAt,
      restartRequested,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return finalizeTask(db, task, {
      status: "error",
      summary: `Task error: ${message}`,
      stepsTaken,
      toolCalls,
      toolsUsed,
      elapsedMs: Date.now() - startedAt,
      restartRequested,
    });
  }
}

function finalizeTask(
  db: Database.Database,
  task: string,
  result: RunTaskResult
): RunTaskResult {
  const uniqueTools = [...new Set(result.toolsUsed)];
  const record = {
    ...result,
    toolsUsed: uniqueTools,
  };

  setMeta(db, "last_task_at", new Date().toISOString());
  setMeta(db, "last_task_status", record.status);
  setMeta(db, "last_task_summary", truncate(record.summary, 500));

  if (record.status === "completed") {
    writeMemory(
      db,
      "procedural",
      `Task completed: ${truncate(task, 200)} → ${truncate(record.summary, 400)}`,
      0.75
    );
  }

  return record;
}

export function formatRunTaskResult(result: RunTaskResult): string {
  const tools =
    result.toolsUsed.length > 0 ? ` Tools used: ${result.toolsUsed.join(", ")}.` : "";
  const timing = ` (${result.stepsTaken} steps, ${result.toolCalls} tool calls, ${Math.round(result.elapsedMs / 1000)}s)`;

  switch (result.status) {
    case "completed":
      return `Task completed${timing}. ${result.summary}${tools}`;
    case "blocked":
      return `Task blocked${timing}. ${result.summary}${tools}`;
    case "timeout":
      return `Task timed out${timing}. ${result.summary}${tools}`;
    case "substep_timeout":
      return `Task stopped — substep took too long${timing}. ${result.summary}${tools}`;
    case "step_limit":
      return `Task hit step limit${timing}. ${result.summary}${tools}`;
    case "error":
      return `Task failed${timing}. ${result.summary}${tools}`;
  }
}
