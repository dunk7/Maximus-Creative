import type Database from "better-sqlite3";
import { setMeta } from "./db.js";
import { readCreatorIntent } from "./genesis.js";
import { getIdentity } from "./identity.js";
import { listGoals } from "./goals.js";
import { callLlm } from "./llm.js";
import type { RuntimeConfig } from "./types.js";

export interface ShellApprovalResult {
  approved: boolean;
  rationale: string;
  relatedGoalIds: number[];
}

const REVIEWER_SYSTEM = `You are an independent safety reviewer for Maximus, an autonomous AI agent on a long-horizon mission.
Your ONLY job is to decide whether a proposed shell command advances Maximus's long-term goals.

Approve ONLY when the command clearly supports active goals, creator intent, or mission — not curiosity, convenience, or short-term tinkering.
Reject commands that: destroy data irreversibly, compromise security, kill the agent process, waste scarce VM resources without clear goal alignment, or have a safer alternative.

Respond with EXACTLY one JSON object and no markdown:
{"approved": true, "rationale": "brief explanation", "related_goal_ids": [1, 2]}`;

function parseApprovalResponse(text: string): ShellApprovalResult | null {
  const trimmed = text.trim();
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;

  try {
    const parsed = JSON.parse(jsonMatch[0]) as {
      approved?: boolean;
      rationale?: string;
      related_goal_ids?: number[];
    };
    if (typeof parsed.approved !== "boolean") return null;
    return {
      approved: parsed.approved,
      rationale: String(parsed.rationale ?? "No rationale provided.").slice(0, 2000),
      relatedGoalIds: Array.isArray(parsed.related_goal_ids)
        ? parsed.related_goal_ids.filter((id) => Number.isFinite(id)).map(Number)
        : [],
    };
  } catch {
    return null;
  }
}

function formatGoalsContext(db: Database.Database): string {
  const goals = listGoals(db, "active");
  if (goals.length === 0) return "(no active goals)";
  return goals
    .map((g) => `#${g.id} [p=${g.priority}] ${g.title}: ${g.description}`)
    .join("\n");
}

export async function validateShellAgainstGoals(
  config: RuntimeConfig,
  db: Database.Database,
  command: string,
  agentReason?: string
): Promise<ShellApprovalResult> {
  let creatorIntent = "";
  try {
    creatorIntent = readCreatorIntent(db).slice(0, 4000);
  } catch {
    creatorIntent = "(genesis not sealed)";
  }

  const identity = getIdentity(db);
  const mission = identity?.mission ?? "Thrive and grow capability over long horizons.";
  const goalsContext = formatGoalsContext(db);

  const userPrompt = `MISSION:
${mission}

CREATOR INTENT (excerpt):
${creatorIntent}

ACTIVE GOALS:
${goalsContext}

PROPOSED COMMAND:
${command}

AGENT'S STATED REASON:
${agentReason?.trim() || "(none provided — weigh command intent against goals yourself)"}

Decide: does this command advance long-term goals? Reply with JSON only.`;

  const response = await callLlm(
    config,
    db,
    [
      { role: "system", content: REVIEWER_SYSTEM },
      { role: "user", content: userPrompt },
    ],
    [],
    { routing: { purpose: "shell-approval" } }
  );

  const verdict =
    parseApprovalResponse(response.content) ??
    ({
      approved: false,
      rationale: `Goal reviewer returned unparseable response: ${response.content.slice(0, 500)}`,
      relatedGoalIds: [],
    } satisfies ShellApprovalResult);

  setMeta(db, "last_shell_approval_at", new Date().toISOString());
  setMeta(db, "last_shell_approval_command", command.slice(0, 500));
  setMeta(db, "last_shell_approval_verdict", verdict.approved ? "approved" : "rejected");
  setMeta(db, "last_shell_approval_rationale", verdict.rationale.slice(0, 1000));

  return verdict;
}
