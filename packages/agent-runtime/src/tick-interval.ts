import type Database from "better-sqlite3";
import { getRuntimeSetting } from "./db.js";
import { clampTickIntervalMs } from "./guardrails.js";
import type { RuntimeConfig } from "./types.js";

export function resolveTickIntervalMs(config: RuntimeConfig, db: Database.Database): number {
  const override = getRuntimeSetting(db, "tick_interval_ms");
  if (override) return clampTickIntervalMs(Number(override));
  return clampTickIntervalMs(config.tickIntervalMs);
}

export function formatTickIntervalLabel(ms: number): string {
  if (ms >= 3_600_000 && ms % 3_600_000 === 0) {
    const hours = ms / 3_600_000;
    return hours === 1 ? "1 hour" : `${hours} hours`;
  }
  const minutes = Math.round(ms / 60_000);
  return minutes === 1 ? "1 minute" : `${minutes} minutes`;
}

export function formatTickIntervalLine(config: RuntimeConfig, db: Database.Database): string {
  const ms = resolveTickIntervalMs(config, db);
  return `Live background tick interval: ${ms} ms (${formatTickIntervalLabel(ms)}).`;
}
