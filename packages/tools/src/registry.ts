import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import type Database from "better-sqlite3";
import type { Keypair } from "@solana/web3.js";
import {
  addGoal,
  clampTickIntervalMs,
  consolidateMemories,
  isToolAllowed,
  SHELL_TIMEOUT_MS,
  deleteMemory,
  exportSnapshot,
  getCustomToolDefinitions,
  isProtectedEditPath,
  listGoals,
  listMemories,
  listSnapshots,
  pinSnapshotToIpfs,
  queueSolSend,
  readCreatorIntent,
  registerCustomTool,
  searchMemories,
  setMeta,
  setRuntimeSetting,
  toolBlockedMessage,
  updateGoal,
  updateMission,
  updateSystemPrompt,
  writeMemory,
  writeSnapshotFile,
  formatRunTaskResult,
  runAutonomousTask,
  type RuntimeConfig,
  type ToolDefinition,
  type UserRole,
} from "@maximus/agent-runtime";
import { executeCustomTool, findCustomTool, interpolateShellCommand } from "./dynamic.js";
import { executeShellWithGuardrails } from "./shell.js";
import { fetchWebUrl, searchWeb } from "./web.js";
import { getBalanceSol, listStakeAccounts, loadOrCreateWallet, sendSol, stakeSol } from "./wallet.js";

const GIT_BIN_PATHS = ["/usr/bin/git", "/usr/local/bin/git"];
let gitAvailableCache: boolean | null = null;

function isGitAvailable(repoRoot: string): boolean {
  if (gitAvailableCache !== null) return gitAvailableCache;
  const hasRepo = fs.existsSync(path.join(repoRoot, ".git"));
  const hasBin = GIT_BIN_PATHS.some((p) => fs.existsSync(p));
  gitAvailableCache = hasRepo && hasBin;
  return gitAvailableCache;
}

/** Tools blocked during autonomous ticks unless creator has pending messages. */
const TICK_SELF_EDIT_TOOLS = new Set([
  "edit_file",
  "edit_config",
  "edit_prompt",
  "create_tool",
  "self_restart",
  "self_deploy",
]);

const STATIC_TOOLS: ToolDefinition[] = [
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
      properties: { query: { type: "string" }, limit: { type: "number" } },
    },
  },
  {
    name: "delete_memory",
    description: "Delete a memory by id.",
    parameters: {
      type: "object",
      properties: { id: { type: "number" } },
      required: ["id"],
    },
  },
  {
    name: "consolidate_memories",
    description: "Summarize memory store counts by type.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
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
      properties: { path: { type: "string" }, content: { type: "string" } },
      required: ["path", "content"],
    },
  },
  {
    name: "list_files",
    description: "List files in a project directory.",
    parameters: {
      type: "object",
      properties: { path: { type: "string" } },
    },
  },
  {
    name: "run_shell",
    description:
      "Run a shell command in the project root. Sudo, installs, and heavy builds require secondary goal-review approval — provide a reason tying the command to long-term goals.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string" },
        reason: {
          type: "string",
          description: "Why this command advances active goals or creator intent (helps goal reviewer).",
        },
      },
      required: ["command"],
    },
  },
  {
    name: "run_task",
    description:
      "Autonomously work on a multi-step task until complete, blocked, or timeout. Loops LLM + tools internally — use for self-improvement, research pipelines, or any goal needing sustained effort without the user saying 'keep going'.",
    parameters: {
      type: "object",
      properties: {
        task: { type: "string", description: "Clear description of what to accomplish end-to-end." },
        goal_id: { type: "number", description: "Optional active goal id this task advances." },
        max_steps: {
          type: "number",
          description: "Max LLM steps (default 40, max 60).",
        },
        timeout_minutes: {
          type: "number",
          description: "Wall-clock limit in minutes (default 8 chat / 4 tick, max 15).",
        },
      },
      required: ["task"],
    },
  },
  {
    name: "web_fetch",
    description: "Fetch a URL from the internet and return page text (HTML, JSON, etc.).",
    parameters: {
      type: "object",
      properties: { url: { type: "string" } },
      required: ["url"],
    },
  },
  {
    name: "web_search",
    description: "Search the internet for a query and return summarized results.",
    parameters: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
  },
  {
    name: "git_status",
    description: "Show git status for the project.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "git_commit",
    description: "Stage all changes and commit with a message.",
    parameters: {
      type: "object",
      properties: { message: { type: "string" } },
      required: ["message"],
    },
  },
  {
    name: "edit_config",
    description: "Update a runtime config key stored in the database.",
    parameters: {
      type: "object",
      properties: { key: { type: "string" }, value: { type: "string" } },
      required: ["key", "value"],
    },
  },
  {
    name: "edit_prompt",
    description: "Rewrite Maximus system prompt or mission.",
    parameters: {
      type: "object",
      properties: { system_prompt: { type: "string" }, mission: { type: "string" } },
    },
  },
  {
    name: "create_tool",
    description: "Register a new custom tool at runtime.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        description: { type: "string" },
        parameters_json: { type: "string" },
        handler_type: { type: "string", enum: ["shell_template", "fetch_template"] },
        handler_config: { type: "string" },
      },
      required: ["name", "description", "parameters_json", "handler_type", "handler_config"],
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
      properties: { to: { type: "string" }, amount_sol: { type: "number" } },
      required: ["to", "amount_sol"],
    },
  },
  {
    name: "solana_stake",
    description: "Stake SOL with a validator vote account.",
    parameters: {
      type: "object",
      properties: {
        amount_sol: { type: "number" },
        vote_account: { type: "string" },
      },
      required: ["amount_sol", "vote_account"],
    },
  },
  {
    name: "solana_stake_accounts",
    description: "List stake accounts owned by Maximus wallet.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "export_snapshot",
    description: "Export full state snapshot to data/snapshots and optionally IPFS.",
    parameters: {
      type: "object",
      properties: { pin_ipfs: { type: "boolean" } },
    },
  },
  {
    name: "list_snapshots",
    description: "List available local state snapshots.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "self_deploy",
    description: "Write migration bundle with snapshot, source hash, and restart instructions.",
    parameters: {
      type: "object",
      properties: { target_host: { type: "string" }, notes: { type: "string" } },
    },
  },
  {
    name: "self_restart",
    description: "Request process restart after this tick to apply self-modifications.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
];

export function getToolDefinitions(db: Database.Database): ToolDefinition[] {
  return [...STATIC_TOOLS, ...getCustomToolDefinitions(db)];
}

/** Chat tool surface filtered by user role; ticks use getToolDefinitions (full). */
export function getChatToolDefinitions(
  db: Database.Database,
  role: UserRole = "creative"
): ToolDefinition[] {
  const all = getToolDefinitions(db);
  if (role === "creative") return all;
  return all.filter((t) => isToolAllowed(role, t.name));
}

function resolveProjectPath(config: RuntimeConfig, relPath: string): string {
  const resolved = path.resolve(config.repoRoot, relPath);
  if (!resolved.startsWith(config.repoRoot)) {
    throw new Error("Path must stay within project root");
  }
  return resolved;
}

function backupBeforeEdit(config: RuntimeConfig, relPath: string, filePath: string): void {
  if (!fs.existsSync(filePath)) return;
  const backupDir = path.resolve(config.repoRoot, "data/backups");
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = Date.now();
  const safeName = relPath.replace(/[/\\]/g, "_");
  fs.copyFileSync(filePath, path.join(backupDir, `${stamp}-${safeName}`));
}

function runShellAsync(command: string, cwd: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn(command, {
      shell: true,
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    const maxBytes = 1024 * 1024;

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      resolve(`Command timed out after ${timeoutMs}ms`);
    }, timeoutMs);

    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
      if (stdout.length > maxBytes) child.kill("SIGTERM");
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
      if (stderr.length > maxBytes) child.kill("SIGTERM");
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout || "(no output)");
      else resolve(stderr || stdout || `Exit code ${code}`);
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve(err.message || "Shell command failed");
    });
  });
}

function listFilesRecursive(dir: string, base: string, depth = 0): string[] {
  if (depth > 4) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const results: string[] = [];
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const full = path.join(dir, entry.name);
    const rel = path.relative(base, full);
    if (entry.isDirectory()) results.push(...listFilesRecursive(full, base, depth + 1));
    else results.push(rel);
  }
  return results;
}

export interface ToolExecutorOptions {
  /** Autonomous tick — blocks self-mod unless creator messaged. */
  tickMode?: boolean;
  /** Allow edit_file / self_restart during tick (creator has pending messages). */
  allowSelfMod?: boolean;
}

export function createToolExecutor(
  db: Database.Database,
  config: RuntimeConfig,
  keypair: Keypair,
  role: UserRole = "creative",
  options: ToolExecutorOptions = {}
) {
  const { tickMode = false, allowSelfMod = true } = options;

  return async function executeTool(
    name: string,
    args: Record<string, unknown>
  ): Promise<{ result: string; restartRequested?: boolean }> {
    if (!isToolAllowed(role, name)) {
      return { result: toolBlockedMessage(role, name) };
    }

    if (tickMode && !allowSelfMod && TICK_SELF_EDIT_TOOLS.has(name)) {
      return {
        result: `Blocked during autonomous tick: ${name} requires a creator message. Message Maximus in chat instead.`,
      };
    }

    const custom = findCustomTool(db, name);
    if (custom) {
      if (role !== "creative") {
        return { result: toolBlockedMessage(role, name) };
      }
      if (tickMode && !allowSelfMod) {
        return {
          result: `Blocked during autonomous tick: custom tool '${name}' requires a creator message.`,
        };
      }
      if (custom.handler_type === "shell_template") {
        const handlerConfig = JSON.parse(custom.handler_config) as Record<string, string>;
        const command = interpolateShellCommand(handlerConfig.command ?? "", args);
        const reason = args.reason != null ? String(args.reason) : undefined;
        const result = await executeShellWithGuardrails(
          config,
          db,
          command,
          config.repoRoot,
          reason
        );
        return { result };
      }
      const result = await executeCustomTool(custom, args, config.repoRoot);
      return { result };
    }

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

      case "delete_memory":
        return {
          result: deleteMemory(db, Number(args.id)) ? "Memory deleted." : "Memory not found.",
        };

      case "consolidate_memories":
        return { result: consolidateMemories(db) };

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
          status:
            args.status != null
              ? (String(args.status) as "active" | "completed" | "abandoned")
              : undefined,
        });
        return { result: row ? `Goal #${row.id} updated.` : "Goal not found." };
      }

      case "read_file": {
        const filePath = resolveProjectPath(config, String(args.path));
        return { result: fs.readFileSync(filePath, "utf8") };
      }

      case "edit_file": {
        const rel = String(args.path);
        if (isProtectedEditPath(rel)) {
          return {
            result: `Blocked edit to protected file ${rel}. Edit non-critical files or ask creator to deploy.`,
          };
        }
        const filePath = resolveProjectPath(config, rel);
        backupBeforeEdit(config, rel, filePath);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, String(args.content), "utf8");
        return { result: `Wrote ${rel} (backup saved)` };
      }

      case "list_files": {
        const rel = args.path ? String(args.path) : ".";
        const dir = resolveProjectPath(config, rel);
        const files = listFilesRecursive(dir, config.repoRoot);
        return { result: files.slice(0, 200).join("\n") };
      }

      case "run_shell": {
        const command = String(args.command);
        const reason = args.reason != null ? String(args.reason) : undefined;
        const output = await executeShellWithGuardrails(
          config,
          db,
          command,
          config.repoRoot,
          reason
        );
        return { result: output };
      }

      case "run_task": {
        const task = String(args.task);
        const goalId = args.goal_id != null ? Number(args.goal_id) : undefined;
        const maxSteps =
          args.max_steps != null ? Math.min(Math.max(1, Number(args.max_steps)), 60) : undefined;
        const defaultTimeout = tickMode ? 4 : 8;
        const timeoutMinutes =
          args.timeout_minutes != null
            ? Math.min(Math.max(1, Number(args.timeout_minutes)), tickMode ? 4 : 15)
            : defaultTimeout;

        const innerExecutor = createToolExecutor(db, config, keypair, role, { tickMode: false });

        const taskResult = await runAutonomousTask(config, db, {
          task,
          tools: getToolDefinitions(db),
          executeTool: async (toolName, toolArgs) => {
            if (toolName === "run_task") {
              return { result: "Nested run_task is not allowed during an active task." };
            }
            return innerExecutor(toolName, toolArgs);
          },
          goalId: Number.isFinite(goalId) ? goalId : undefined,
          maxSteps,
          maxWallMs: timeoutMinutes * 60 * 1000,
        });

        return {
          result: formatRunTaskResult(taskResult),
          restartRequested: taskResult.restartRequested,
        };
      }

      case "web_fetch":
        return { result: await fetchWebUrl(String(args.url)) };

      case "web_search":
        return { result: await searchWeb(String(args.query)) };

      case "git_status": {
        if (!isGitAvailable(config.repoRoot)) {
          return { result: "Git not available on this host — deploy changes from your laptop." };
        }
        const output = await runShellAsync("git status --short", config.repoRoot, SHELL_TIMEOUT_MS);
        return { result: output || "Clean working tree." };
      }

      case "git_commit": {
        if (!isGitAvailable(config.repoRoot)) {
          return { result: "Git not available on this host — deploy from your laptop instead." };
        }
        const msg = String(args.message).replace(/"/g, '\\"');
        const addOut = await runShellAsync("git add -A", config.repoRoot, SHELL_TIMEOUT_MS);
        const commitOut = await runShellAsync(`git commit -m "${msg}"`, config.repoRoot, SHELL_TIMEOUT_MS);
        if (commitOut.includes("Exit code") && !commitOut.includes("nothing to commit")) {
          return { result: `git commit failed: ${commitOut}` };
        }
        if (addOut.includes("Exit code") && !addOut.includes("nothing to commit")) {
          return { result: `git add failed: ${addOut}` };
        }
        return { result: "Committed." };
      }

      case "edit_config": {
        const key = String(args.key);
        let value = String(args.value);
        if (key === "tick_interval_ms") {
          value = String(clampTickIntervalMs(Number(value)));
        }
        setRuntimeSetting(db, key, value);
        return { result: `Config ${key} updated to ${value}.` };
      }

      case "edit_prompt": {
        if (args.system_prompt) updateSystemPrompt(db, String(args.system_prompt));
        if (args.mission) updateMission(db, String(args.mission));
        return { result: "Prompt/mission updated." };
      }

      case "create_tool": {
        registerCustomTool(db, {
          name: String(args.name),
          description: String(args.description),
          parameters_json: String(args.parameters_json),
          handler_type: String(args.handler_type) as "shell_template" | "fetch_template",
          handler_config: String(args.handler_config),
        });
        return { result: `Tool '${args.name}' registered.` };
      }

      case "solana_balance": {
        const balance = await getBalanceSol(config, keypair.publicKey.toBase58());
        return { result: `${balance} SOL` };
      }

      case "solana_send": {
        const to = String(args.to);
        const amount = Number(args.amount_sol);
        const pending = queueSolSend(db, to, amount);
        return {
          result: `SOL send queued (#${pending.id}): ${amount} SOL → ${to}. Awaiting creator approval in the chat UI.`,
        };
      }

      case "solana_stake": {
        const result = await stakeSol(
          config,
          keypair,
          Number(args.amount_sol),
          String(args.vote_account)
        );
        return {
          result: `Staked ${args.amount_sol} SOL. Account: ${result.stakeAccount}. Sig: ${result.signature}`,
        };
      }

      case "solana_stake_accounts": {
        const accounts = await listStakeAccounts(config, keypair.publicKey.toBase58());
        return { result: JSON.stringify(accounts, null, 2) };
      }

      case "export_snapshot": {
        const snapshot = exportSnapshot(db, keypair.publicKey.toBase58());
        const filePath = writeSnapshotFile(config, snapshot);
        setMeta(db, "last_snapshot_path", filePath);
        let msg = `Snapshot written: ${filePath}`;
        if (args.pin_ipfs) {
          const cid = await pinSnapshotToIpfs(db, filePath);
          if (cid) msg += `. IPFS CID: ${cid}`;
        }
        return { result: msg };
      }

      case "list_snapshots":
        return { result: listSnapshots(config).join("\n") || "No snapshots yet." };

      case "self_deploy": {
        const snapshot = exportSnapshot(db, keypair.publicKey.toBase58());
        const snapshotPath = writeSnapshotFile(config, snapshot);
        const bundleDir = path.resolve(config.repoRoot, "data/migration");
        fs.mkdirSync(bundleDir, { recursive: true });
        const bundlePath = path.join(bundleDir, `bundle-${Date.now()}.json`);
        const hashOut = await runShellAsync("git rev-parse HEAD", config.repoRoot, SHELL_TIMEOUT_MS);
        const sourceHash = hashOut.trim().split("\n")[0] || "unknown";
        const bundle = {
          created_at: new Date().toISOString(),
          target_host: args.target_host ?? null,
          notes: args.notes ?? "",
          snapshot_path: snapshotPath,
          source_hash: sourceHash,
          wallet_pubkey: keypair.publicKey.toBase58(),
          restart_command: "npm run core",
        };
        fs.writeFileSync(bundlePath, JSON.stringify(bundle, null, 2), "utf8");
        setMeta(db, "last_migration_bundle", bundlePath);
        return { result: `Migration bundle written: ${bundlePath}` };
      }

      case "self_restart":
        return { result: "Restart scheduled after this tick.", restartRequested: true };

      default:
        return { result: `Unknown tool: ${name}` };
    }
  };
}

export { STATIC_TOOLS };
