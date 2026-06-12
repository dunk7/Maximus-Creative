import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { setMeta } from "./db.js";
import { readCreatorIntent } from "./genesis.js";
import { getIdentity } from "./identity.js";
import { listGoals } from "./goals.js";
import { listJournal } from "./journal.js";
import { listMemories } from "./memory.js";
import { getMeta } from "./db.js";
import type { RuntimeConfig } from "./types.js";

export interface StateSnapshot {
  version: 1;
  exported_at: string;
  tick_number: string | null;
  identity: ReturnType<typeof getIdentity>;
  creator_intent: string;
  goals: ReturnType<typeof listGoals>;
  memories: ReturnType<typeof listMemories>;
  journal: ReturnType<typeof listJournal>;
  runtime_config: Array<{ key: string; value: string }>;
  wallet_pubkey: string | null;
}

export function exportSnapshot(
  db: Database.Database,
  walletPubkey: string | null
): StateSnapshot {
  const runtimeConfig = db
    .prepare("SELECT key, value FROM runtime_config")
    .all() as Array<{ key: string; value: string }>;

  return {
    version: 1,
    exported_at: new Date().toISOString(),
    tick_number: getMeta(db, "tick_number"),
    identity: getIdentity(db),
    creator_intent: readCreatorIntent(db),
    goals: listGoals(db),
    memories: listMemories(db, 500),
    journal: listJournal(db, 100),
    runtime_config: runtimeConfig,
    wallet_pubkey: walletPubkey,
  };
}

export function writeSnapshotFile(
  config: RuntimeConfig,
  snapshot: StateSnapshot
): string {
  const dir = path.resolve(config.repoRoot, "data/snapshots");
  fs.mkdirSync(dir, { recursive: true });
  const filename = `snapshot-${Date.now()}.json`;
  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2), "utf8");

  const latestPath = path.join(dir, "latest.json");
  fs.writeFileSync(latestPath, JSON.stringify(snapshot, null, 2), "utf8");
  return filePath;
}

export async function pinSnapshotToIpfs(
  db: Database.Database,
  filePath: string
): Promise<string | null> {
  const apiKey = process.env.WEB3_STORAGE_TOKEN ?? process.env.PINATA_JWT;
  if (!apiKey) return null;

  const content = fs.readFileSync(filePath);
  const res = await fetch("https://api.web3.storage/upload", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: content,
  });

  if (!res.ok) return null;
  const data = (await res.json()) as { cid?: string };
  if (data.cid) {
    setMeta(db, "last_ipfs_cid", data.cid);
  }
  return data.cid ?? null;
}

export function listSnapshots(config: RuntimeConfig): string[] {
  const dir = path.resolve(config.repoRoot, "data/snapshots");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.startsWith("snapshot-") && f.endsWith(".json"))
    .map((f) => path.join(dir, f))
    .sort();
}
