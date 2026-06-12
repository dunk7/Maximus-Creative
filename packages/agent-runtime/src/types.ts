export type MemoryType = "episodic" | "semantic" | "procedural";
export type GoalStatus = "active" | "completed" | "abandoned";

export interface MemoryRow {
  id: number;
  type: MemoryType;
  content: string;
  importance: number;
  source: string;
  created_at: string;
}

export interface GoalRow {
  id: number;
  title: string;
  description: string;
  priority: number;
  status: GoalStatus;
  parent_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface JournalRow {
  id: number;
  tick_number: number;
  content: string;
  created_at: string;
}

export interface AgentIdentity {
  name: string;
  mission: string;
  system_prompt: string;
  created_at: string;
}

export interface RuntimeConfig {
  repoRoot: string;
  databasePath: string;
  walletPath: string;
  creatorIntentPath: string;
  genesisArchivePath: string;
  llmProvider: "openai" | "anthropic";
  llmApiKey: string;
  llmModel: string;
  tickIntervalMs: number;
  wakePort: number;
  wakeSecret: string;
  solanaRpcUrl: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface TickContext {
  tickNumber: number;
  identity: AgentIdentity;
  goals: GoalRow[];
  recentMemories: MemoryRow[];
  recentJournal: JournalRow[];
  walletPubkey: string | null;
  walletBalanceSol: number | null;
  creatorIntentAvailable: boolean;
}

export interface TickResult {
  summary: string;
  toolCalls: number;
  restartRequested: boolean;
}
