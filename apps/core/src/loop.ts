import os from "node:os";
import {
  answerCreatorMessage,
  buildTickContext,
  getMeta,
  getTickNumber,
  incrementTickNumber,
  isGenesisComplete,
  listJournal,
  loadConfig,
  MAX_TICK_TOOL_CALLS,
  openDatabase,
  runTick,
  setMeta,
  shouldSkipIdleTick,
  writeJournal,
} from "@maximus/agent-runtime";
import {
  createToolExecutor,
  getBalanceSol,
  getToolDefinitions,
  loadOrCreateWallet,
} from "@maximus/tools";
import { forceReleaseAgentLock, withAgentLock } from "./agent-lock.js";
import { buildAgentStatus, getEffectiveTickIntervalMs, invalidateStatusCache } from "./status.js";
import { runStartupRepair } from "./repair.js";
import { startWakeServer } from "./wake-server.js";

const TICK_MAX_MS = 3 * 60 * 1000;
const LOW_MEMORY_SKIP_BYTES = 220 * 1024 * 1024;
const BOOT_TICK_DELAY_MS = Number(process.env.BOOT_TICK_DELAY_MS ?? 60_000);

let wakeNow = false;
let runningTick = false;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTickTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${TICK_MAX_MS}ms`)),
      TICK_MAX_MS
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function runTickBody(forceRun: boolean): Promise<void> {
  const config = loadConfig();
  const db = openDatabase(config);

  if (!isGenesisComplete(db)) {
    throw new Error("Genesis not complete. Run: npm run genesis");
  }

  const keypair = loadOrCreateWallet(config);
  const pubkey = keypair.publicKey.toBase58();
  let balance: number | null = null;

  try {
    balance = await getBalanceSol(config, pubkey);
  } catch (err) {
    console.warn("Could not fetch wallet balance:", err);
  }

  const previewTick = getTickNumber(db) + 1;
  const ctx = buildTickContext(db, previewTick, pubkey, balance);
  const lastTickAt = getMeta(db, "last_tick_at");

  if (shouldSkipIdleTick(ctx, lastTickAt, forceRun)) {
    console.log("[Tick] tick skipped — idle");
    setMeta(db, "last_tick_at", new Date().toISOString());
    return;
  }

  if (os.freemem() < LOW_MEMORY_SKIP_BYTES) {
    console.warn(`[Tick] low memory skip (${Math.round(os.freemem() / 1024 / 1024)}MB free)`);
    setMeta(db, "last_tick_at", new Date().toISOString());
    return;
  }

  const tickNumber = incrementTickNumber(db);
  ctx.tickNumber = tickNumber;
  const executeTool = createToolExecutor(db, config, keypair, "creative", { tickMode: true });

  console.log(`\n[Tick #${tickNumber}] starting...`);
  const result = await runTick(db, config, ctx, getToolDefinitions(db), executeTool, {
    maxToolCalls: MAX_TICK_TOOL_CALLS,
  });
  console.log(`[Tick #${tickNumber}] ${result.summary.slice(0, 500)}`);
  console.log(`[Tick #${tickNumber}] tool calls: ${result.toolCalls}`);
  invalidateStatusCache();

  for (const message of ctx.pendingCreatorMessages) {
    answerCreatorMessage(db, message.id, result.replyText, tickNumber);
    console.log(`[Tick #${tickNumber}] answered creator message #${message.id}`);
  }

  if (result.restartRequested) {
    console.log("Self-restart requested. Exiting for supervisor restart...");
    process.exit(0);
  }
}

async function executeTick(forceRun = false): Promise<void> {
  if (runningTick) return;

  try {
    await withAgentLock(async () => {
      if (runningTick) return;
      runningTick = true;

      try {
        await withTickTimeout(runTickBody(forceRun), "Tick");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[Tick] failed but Maximus survives: ${message}`);
        if (message.includes("timed out")) {
          forceReleaseAgentLock("tick timeout");
        }
        try {
          const config = loadConfig();
          const db = openDatabase(config);
          const tick = getMeta(db, "tick_number") ?? "?";
          writeJournal(db, Number(tick), `Tick error (non-fatal): ${message.slice(0, 500)}`);
        } catch {
          // ignore secondary failure
        }
      } finally {
        runningTick = false;
      }
    }, { reason: "tick" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[Tick] could not acquire lock: ${message}`);
  }
}

export async function startImmortalLoop(): Promise<void> {
  runStartupRepair();
  const config = loadConfig();
  const db = openDatabase(config);

  startWakeServer(config, {
    onWake: () => {
      wakeNow = true;
    },
  });

  const tickIntervalMs = getEffectiveTickIntervalMs(config, db);

  console.log("\n=== MAXIMUS CORE ONLINE ===\n");
  console.log(`Tick interval: ${tickIntervalMs}ms`);
  console.log(`Wallet: ${loadOrCreateWallet(config).publicKey.toBase58()}`);

  if (BOOT_TICK_DELAY_MS > 0) {
    console.log(`Deferring boot tick ${BOOT_TICK_DELAY_MS}ms so SSH/RAM can settle...`);
    await sleep(BOOT_TICK_DELAY_MS);
  }

  try {
    await executeTick();
  } catch (err) {
    console.error("[Loop] initial tick error (continuing):", err);
  }

  while (true) {
    try {
      if (wakeNow) {
        wakeNow = false;
        await executeTick(false);
      }

      await sleep(5000);

      const interval = getEffectiveTickIntervalMs(config, db);
      const lastTickAt = db
        .prepare("SELECT value FROM meta WHERE key = 'last_tick_at'")
        .get() as { value: string } | undefined;
      const elapsed = lastTickAt ? Date.now() - new Date(lastTickAt.value).getTime() : Infinity;

      if (elapsed >= interval) {
        await executeTick();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[Loop] outer error (surviving): ${message}`);
      await sleep(5000);
    }
  }
}

export async function runSingleTick(): Promise<void> {
  await executeTick();
}

export async function printStatus(): Promise<void> {
  const config = loadConfig();
  const db = openDatabase(config);
  const status = await buildAgentStatus(db);
  console.log(JSON.stringify(status, null, 2));
}
