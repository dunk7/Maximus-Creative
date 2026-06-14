import fs from "node:fs";
import path from "node:path";
import {
  clampTickIntervalMs,
  DEFAULT_TICK_INTERVAL_MS,
  loadConfig,
  openDatabase,
  setMeta,
  setRuntimeSetting,
} from "@maximus/agent-runtime";

const STALE_TICK_MS = 10 * 60 * 1000;

export function runStartupRepair(): void {
  const config = loadConfig();
  const db = openDatabase(config);

  const override = db
    .prepare("SELECT value FROM runtime_config WHERE key = 'tick_interval_ms'")
    .get() as { value: string } | undefined;

  if (config.repoRoot === "/opt/maximus") {
    const target = String(DEFAULT_TICK_INTERVAL_MS);
    if (!override) {
      setRuntimeSetting(db, "tick_interval_ms", target);
      console.warn(`[Repair] DB tick_interval_ms missing — set to ${target}`);
    } else {
      const clamped = clampTickIntervalMs(Number(override.value));
      if (String(clamped) !== override.value) {
        setRuntimeSetting(db, "tick_interval_ms", String(clamped));
        console.warn(`[Repair] Tick interval was ${override.value}ms — clamped to ${clamped}ms`);
      }
    }
  } else if (override) {
    const target = clampTickIntervalMs(Number(override.value));
    if (String(target) !== override.value) {
      setRuntimeSetting(db, "tick_interval_ms", String(target));
      console.warn(`[Repair] Tick interval was ${override.value}ms — clamped to ${target}ms`);
    }
  }

  const critical = [
    path.join(config.repoRoot, "packages/agent-runtime/dist/index.js"),
    path.join(config.repoRoot, "packages/tools/dist/index.js"),
    path.join(config.repoRoot, "apps/core/src/cli.ts"),
    path.join(config.repoRoot, "apps/core/src/loop.ts"),
    path.join(config.repoRoot, "apps/core/src/wake-server.ts"),
  ];

  let missingDist = false;
  for (const file of critical) {
    if (!fs.existsSync(file)) {
      console.error(`[Repair] Missing critical file: ${file}`);
      missingDist = true;
    }
  }
  if (missingDist) {
    console.error("[Repair] Run ./scripts/recover-oracle.sh from your laptop to redeploy.");
  }

  const envPath = path.join(config.repoRoot, ".env");
  if (fs.existsSync(envPath)) {
    const env = fs.readFileSync(envPath, "utf8");
    const match = env.match(/^TICK_INTERVAL_MS=(\d+)/m);
    const dbTick = db
      .prepare("SELECT value FROM runtime_config WHERE key = 'tick_interval_ms'")
      .get() as { value: string } | undefined;
    const effective = dbTick?.value ?? String(DEFAULT_TICK_INTERVAL_MS);
    if (!match || match[1] !== effective) {
      const fixed = match
        ? env.replace(/^TICK_INTERVAL_MS=.*/m, `TICK_INTERVAL_MS=${effective}`)
        : `${env.trimEnd()}\nTICK_INTERVAL_MS=${effective}\n`;
      fs.writeFileSync(envPath, fixed, "utf8");
      console.warn(`[Repair] .env TICK_INTERVAL_MS synced to ${effective}`);
    } else if (config.repoRoot !== "/opt/maximus" && match && Number(match[1]) < 60_000) {
      const fixed = env.replace(/^TICK_INTERVAL_MS=.*/m, `TICK_INTERVAL_MS=${DEFAULT_TICK_INTERVAL_MS}`);
      fs.writeFileSync(envPath, fixed, "utf8");
      console.warn(`[Repair] .env TICK_INTERVAL_MS reset to ${DEFAULT_TICK_INTERVAL_MS}`);
    }
  }

  const lastTickAt = db.prepare("SELECT value FROM meta WHERE key = 'last_tick_at'").get() as
    | { value: string }
    | undefined;
  if (lastTickAt?.value) {
    const age = Date.now() - new Date(lastTickAt.value).getTime();
    if (age > STALE_TICK_MS) {
      console.warn(`[Repair] Last tick was ${Math.round(age / 60000)}m ago — clearing stale tick marker`);
      setMeta(db, "tick_in_progress", "");
    }
  }

  setMeta(db, "startup_repair_at", new Date().toISOString());
  console.log("[Repair] Startup checks complete");
}
