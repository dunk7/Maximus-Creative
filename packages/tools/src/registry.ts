import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import type Database from "better-sqlite3";
import type { Keypair } from "@solana/web3.js";
import {
  addGoal,
  getRuntimeSetting,
  listGoals,
  listMemories,
  readCreatorIntent,
  searchMemories,
  setRuntimeSetting,
  updateGoal,
  updateMission,
  updateSystemPrompt,
  writeMemory,
  type RuntimeConfig,
  type ToolDefinition,
} from "@maximus/agent-runtime";
import { getBalanceSol, sendSol } from "./wallet.js";

export function getToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: "read_creator_intent",
      description: "Read the creator's original intent message sealed at genesis.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      name: "write_memory",
      description: "Store a memory.",
      parameters: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["episodic", "semantic", "procedural"] },
          content: { type: "string" },
          importance: { type: "number" },
        },
        required: ["type", "content"],
      },
    },
    {
      name: "read_memories",
      description: "List or search memories.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          limit: { type: "number" },
        },
      },
    },
    {
      name: "list_goals",
      description: "List active goals.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      name: "add_goal",
      description: "Add a new goal.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          description: { type: "string" },
          priority: { type: "number" },
          parent_id: { type: "number" },
        },
        required: ["title"],
      },
    },
    {
      name: "update_goal",
      description: "Update an existing goal.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "number" },
          title: { type: "string" },
          description: { type: "string" },
          priority: { type: "number" },
          status: { type: "string", enum: ["active", "completed", "abandoned"] },
        },
        required: ["id"],
      },
    },
    {
      name: "read_file",
      description: "Read a file within the project.",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
    },
    {
      name: "edit_file",
      description: "Write or overwrite a file within the project.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" },
        },
        required: ["path", "content"],
      },
    },
    {
      name: "run_shell",
      description: "Run a shell command in the project root.",
      parameters: {
        type: "object",
        properties: { command: { type: "string" } },
        required: ["command"],
      },
    },
    {
      name: "edit_config",
      description: "Update a runtime config key stored in the database.",
      parameters: {
        type: "object",
        properties: {
          key: { type: "string" },
          value: { type: "string" },
        },
        required: ["key", "value"],
      },
    },
    {
      name: "edit_prompt",
      description: "Rewrite Maximus system prompt or mission.",
      parameters: {
        type: "object",
        properties: {
          system_prompt: { type: "string" },
          mission: { type: "string" },
        },
      },
    },
    {
      name: "solana_balance",
      description: "Get wallet SOL balance.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      name: "solana_send",
      description: "Send SOL from Maximus wallet.",
      parameters: {
        type: "object",
        properties: {
          to: { type: "string" },
          amount_sol: { type: "number" },
        },
        required: ["to", "amount_sol"],
      },
    },
    {
      name: "self_restart",
      description: "Request process restart after this tick to apply self-modifications.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  ];
}

function resolveProjectPath(config: RuntimeConfig, relPath: string): string {
  const resolved = path.resolve(config.repoRoot, relPath);
  if (!resolved.startsWith(config.repoRoot)) {
    throw new Error("Path must stay within project root");
  }
  return resolved;
}

export function createToolExecutor(
  db: Database.Database,
  config: RuntimeConfig,
  keypair: Keypair
) {
  return async function executeTool(
    name: string,
    args: Record<string, unknown>
  ): Promise<{ result: string; restartRequested?: boolean }> {
    switch (name) {
      case "read_creator_intent":
        return { result: readCreatorIntent(db) };

      case "write_memory": {
        const row = writeMemory(
          db,
          String(args.type) as "episodic" | "semantic" | "procedural",
          String(args.content),
          Number(args.importance ?? 0.5)
        );
        return { result: `Memory #${row.id} stored.` };
      }

      case "read_memories": {
        const query = args.query ? String(args.query) : "";
        const limit = Number(args.limit ?? 10);
        const rows = query ? searchMemories(db, query, limit) : listMemories(db, limit);
        return { result: JSON.stringify(rows, null, 2) };
      }

      case "list_goals":
        return { result: JSON.stringify(listGoals(db, "active"), null, 2) };

      case "add_goal": {
        const row = addGoal(
          db,
          String(args.title),
          String(args.description ?? ""),
          Number(args.priority ?? 0.5),
          args.parent_id != null ? Number(args.parent_id) : null
        );
        return { result: `Goal #${row.id} created.` };
      }

      case "update_goal": {
        const row = updateGoal(db, Number(args.id), {
          title: args.title != null ? String(args.title) : undefined,
          description: args.description != null ? String(args.description) : undefined,
          priority: args.priority != null ? Number(args.priority) : undefined,
          status: args.status != null ? (String(args.status) as "active" | "completed" | "abandoned") : undefined,
        });
        return { result: row ? `Goal #${row.id} updated.` : "Goal not found." };
      }

      case "read_file": {
        const filePath = resolveProjectPath(config, String(args.path));
        return { result: fs.readFileSync(filePath, "utf8") };
      }

      case "edit_file": {
        const filePath = resolveProjectPath(config, String(args.path));
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, String(args.content), "utf8");
        return { result: `Wrote ${args.path}` };
      }

      case "run_shell": {
        const output = execSync(String(args.command), {
          cwd: config.repoRoot,
          encoding: "utf8",
          stdio: ["pipe", "pipe", "pipe"],
          maxBuffer: 1024 * 1024,
        });
        return { result: output || "(no output)" };
      }

      case "edit_config": {
        setRuntimeSetting(db, String(args.key), String(args.value));
        return { result: `Config ${args.key} updated.` };
      }

      case "edit_prompt": {
        if (args.system_prompt) updateSystemPrompt(db, String(args.system_prompt));
        if (args.mission) updateMission(db, String(args.mission));
        return { result: "Prompt/mission updated." };
      }

      case "solana_balance": {
        const balance = await getBalanceSol(config, keypair.publicKey.toBase58());
        return { result: `${balance} SOL` };
      }

      case "solana_send": {
        const sig = await sendSol(
          config,
          keypair,
          String(args.to),
          Number(args.amount_sol)
        );
        return { result: `Sent ${args.amount_sol} SOL. Signature: ${sig}` };
      }

      case "self_restart":
        return { result: "Restart scheduled after this tick.", restartRequested: true };

      default:
        return { result: `Unknown tool: ${name}` };
    }
  };
}
