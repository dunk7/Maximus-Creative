import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { RuntimeConfig } from "./types.js";

function findRepoRoot(startDir: string): string {
  let current = path.resolve(startDir);
  while (true) {
    const marker = path.join(current, "genesis", "creator_intent.md");
    const pkg = path.join(current, "package.json");
    if (fs.existsSync(marker)) return current;
    if (fs.existsSync(pkg)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(pkg, "utf8")) as { name?: string };
        if (parsed.name === "maximus-creative") return current;
      } catch {
        // keep walking
      }
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new Error("Could not locate Maximus Creative repo root");
}

export function loadConfig(_cwd = process.cwd()): RuntimeConfig {
  const repoRoot = findRepoRoot(path.dirname(fileURLToPath(import.meta.url)));

  return {
    repoRoot,
    databasePath: path.resolve(repoRoot, process.env.DATABASE_PATH ?? "./data/agent.db"),
    walletPath: path.resolve(repoRoot, process.env.AGENT_WALLET_PATH ?? "./wallet/agent.json"),
    creatorIntentPath: path.resolve(repoRoot, "genesis/creator_intent.md"),
    genesisArchivePath: path.resolve(repoRoot, "data/genesis/creator_intent.original"),
    llmProvider: (process.env.LLM_PROVIDER ?? "openai") as RuntimeConfig["llmProvider"],
    llmApiKey: process.env.LLM_API_KEY ?? "",
    llmModel: process.env.LLM_MODEL ?? "gpt-4o-mini",
    tickIntervalMs: Number(process.env.TICK_INTERVAL_MS ?? 900000),
    wakePort: Number(process.env.WAKE_PORT ?? 4747),
    wakeSecret: process.env.WAKE_SECRET ?? "maximus-dev-secret",
    solanaRpcUrl: process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com",
  };
}
