import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import type { RuntimeConfig } from "./types.js";
import { getMeta, setMeta } from "./db.js";

export function isGenesisComplete(db: Database.Database): boolean {
  return getMeta(db, "genesis_complete") === "true";
}

export function sealCreatorIntent(db: Database.Database, config: RuntimeConfig): string {
  const existing = db.prepare("SELECT creator_intent FROM genesis WHERE id = 1").get() as
    | { creator_intent: string }
    | undefined;
  if (existing) return existing.creator_intent;

  if (!fs.existsSync(config.creatorIntentPath)) {
    throw new Error(`Creator intent not found at ${config.creatorIntentPath}`);
  }

  const intent = fs.readFileSync(config.creatorIntentPath, "utf8").trim();
  fs.mkdirSync(path.dirname(config.genesisArchivePath), { recursive: true });
  fs.writeFileSync(config.genesisArchivePath, intent, "utf8");

  const sealedAt = new Date().toISOString();
  db.prepare(
    "INSERT INTO genesis (id, creator_intent, sealed_at, source_path) VALUES (1, ?, ?, ?)"
  ).run(intent, sealedAt, config.creatorIntentPath);

  setMeta(db, "genesis_complete", "true");
  setMeta(db, "genesis_sealed_at", sealedAt);
  return intent;
}

export function readCreatorIntent(db: Database.Database): string {
  const row = db.prepare("SELECT creator_intent FROM genesis WHERE id = 1").get() as
    | { creator_intent: string }
    | undefined;
  if (!row) throw new Error("Genesis not complete. Run genesis boot first.");
  return row.creator_intent;
}
