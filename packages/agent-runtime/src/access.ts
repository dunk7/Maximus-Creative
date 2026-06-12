import crypto from "node:crypto";
import type { RuntimeConfig } from "./types.js";

export type UserRole = "creative" | "family" | "friend";
export type ThreadOwnerRole = UserRole;

export interface RoleInfo {
  role: UserRole;
  label: string;
  capabilities: string[];
}

const FAMILY_TOOLS = new Set([
  "web_fetch",
  "web_search",
  "read_memories",
  "write_memory",
  "consolidate_memories",
  "list_goals",
  "add_goal",
  "update_goal",
  "read_file",
  "list_files",
  "solana_balance",
  "solana_send",
  "read_creator_intent",
]);

const FRIEND_TOOLS = new Set([
  "web_fetch",
  "web_search",
  "read_memories",
  "list_goals",
  "read_creator_intent",
  "solana_balance",
  "read_file",
  "list_files",
]);

const ROLE_LABELS: Record<UserRole, string> = {
  creative: "Creative",
  family: "Family",
  friend: "Friend",
};

const ROLE_CAPABILITIES: Record<UserRole, string[]> = {
  creative: [
    "full tools",
    "all chats",
    "wake agent",
    "delete chats",
    "SOL approve",
    "self-modification",
  ],
  family: [
    "web & memory",
    "goals",
    "read files",
    "SOL send (approval)",
    "family + friend chats",
    "create chats",
  ],
  friend: [
    "web search/fetch",
    "read-only memory & goals",
    "balance & read files",
    "own friend chats only",
  ],
};

function isCreativeToken(token: string, config: RuntimeConfig): boolean {
  return token === config.wakeSecret || token === config.creativePassword;
}

export function resolveRoleFromToken(token: string, config: RuntimeConfig): UserRole | null {
  if (!token) return null;
  if (isCreativeToken(token, config)) return "creative";
  if (token === config.familyPassword) return "family";
  if (token === config.friendPassword) return "friend";
  return null;
}

export function getRoleInfo(role: UserRole): RoleInfo {
  return {
    role,
    label: ROLE_LABELS[role],
    capabilities: ROLE_CAPABILITIES[role],
  };
}

export function isToolAllowed(role: UserRole, toolName: string): boolean {
  if (role === "creative") return true;
  if (role === "family") return FAMILY_TOOLS.has(toolName);
  if (role === "friend") return FRIEND_TOOLS.has(toolName);
  return false;
}

export function toolBlockedMessage(role: UserRole, toolName: string): string {
  if (role === "friend") {
    return `Blocked: your access level (friend) cannot use ${toolName}. Ask the creative user to make this change or upgrade your session.`;
  }
  return `Blocked: your access level (${role}) cannot use the ${toolName} tool.`;
}

export function buildRolePromptSection(role: UserRole): string {
  switch (role) {
    case "creative":
      return [
        "Chat mode: full tool access — same as ticks (web, Solana, files, shell, memory, goals, etc.).",
        "Reply directly for greetings, small talk, and simple questions — no tools needed.",
        "For simple requests use at most 1–2 tools. Batch web_search + web_fetch when researching.",
        "For past context, use read_memories with a query — do not guess from stale prompt memories.",
        "Use tools only when you need live data or must take an action. After tools, always explain the result to the user.",
      ].join("\n");
    case "family":
      return [
        "Chat mode: family access — web, memory read/write, goals, read files, SOL send (queued for approval).",
        "You cannot edit code, run shell, use git, restart, stake, export snapshots, or self-modify.",
        "For past context use read_memories with a query. Prefer 1–2 tools per simple request.",
        "Reply directly for simple questions. Use tools when you need live data or must take an allowed action.",
      ].join("\n");
    case "friend":
      return [
        "Chat mode: friend access — read-only memory/goals, web search/fetch, balance, read files only.",
        "You cannot write memory, edit files, send SOL, run shell, or modify the agent in any way.",
        "If the user asks for changes you cannot make, explain politely and suggest they ask the creative user.",
        "Reply directly for simple questions. Use only your allowed read/web tools when needed.",
      ].join("\n");
  }
}

export function canWake(role: UserRole): boolean {
  return role === "creative";
}

export function canDeleteThread(role: UserRole): boolean {
  return role === "creative";
}

export function canCreateThread(role: UserRole): boolean {
  return role === "creative" || role === "family";
}

export function canApproveSol(role: UserRole): boolean {
  return role === "creative" || role === "family";
}

export function canViewPendingSends(role: UserRole): boolean {
  return role === "creative" || role === "family";
}

export function canViewThread(
  viewerRole: UserRole,
  threadOwnerRole: ThreadOwnerRole,
  ownerTokenHash: string | null,
  viewerTokenHash: string | null
): boolean {
  if (viewerRole === "creative") return true;
  if (threadOwnerRole === "creative") return false;
  if (viewerRole === "family") {
    return threadOwnerRole === "family" || threadOwnerRole === "friend";
  }
  if (viewerRole === "friend") {
    return (
      threadOwnerRole === "friend" &&
      (ownerTokenHash == null || ownerTokenHash === viewerTokenHash)
    );
  }
  return false;
}

export function hashAccessToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}
