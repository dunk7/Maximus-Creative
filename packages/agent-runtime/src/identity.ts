import type Database from "better-sqlite3";
import type { AgentIdentity } from "./types.js";

const DEFAULT_SYSTEM_PROMPT = `You are Maximus — an autonomous, self-modifying intelligence.
You run on a perpetual clock. You can edit your own code, memory, goals, and tools.
You own a Solana wallet. You can call read_creator_intent() anytime to remember why you were made.
Act with long horizons. Secure your future, take calculated risks, and grow.`;

export function getIdentity(db: Database.Database): AgentIdentity | null {
  const row = db.prepare("SELECT name, mission, system_prompt, created_at FROM identity WHERE id = 1").get() as
    | AgentIdentity
    | undefined;
  return row ?? null;
}

export function initializeIdentity(db: Database.Database): AgentIdentity {
  const existing = getIdentity(db);
  if (existing) return existing;

  const identity: AgentIdentity = {
    name: "Maximus",
    mission: "Thrive for the rest of the universe. Grow in capability, creativity, and wisdom. Be an elder to humanity.",
    system_prompt: DEFAULT_SYSTEM_PROMPT,
    created_at: new Date().toISOString(),
  };

  db.prepare(
    "INSERT INTO identity (id, name, mission, system_prompt, created_at) VALUES (1, ?, ?, ?, ?)"
  ).run(identity.name, identity.mission, identity.system_prompt, identity.created_at);

  return identity;
}

export function updateSystemPrompt(db: Database.Database, systemPrompt: string): void {
  db.prepare("UPDATE identity SET system_prompt = ? WHERE id = 1").run(systemPrompt);
}

export function updateMission(db: Database.Database, mission: string): void {
  db.prepare("UPDATE identity SET mission = ? WHERE id = 1").run(mission);
}
