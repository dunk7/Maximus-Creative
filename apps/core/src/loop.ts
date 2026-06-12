import {
  buildTickContext,
  incrementTickNumber,
  isGenesisComplete,
  listJournal,
  loadConfig,
  openDatabase,
  runTick,
} from "@maximus/agent-runtime";
import {
  createToolExecutor,
  getBalanceSol,
  getToolDefinitions,
  loadOrCreateWallet,
} from "@maximus/tools";
import { startWakeServer } from "./wake-server.js";

let wakeNow = false;
let runningTick = false;

async function executeTick(): Promise<void> {
  if (runningTick) return;
  runningTick = true;

  try {
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

    const tickNumber = incrementTickNumber(db);
    const ctx = buildTickContext(db, tickNumber, pubkey, balance);
    const executeTool = createToolExecutor(db, config, keypair);

    console.log(`\n[Tick #${tickNumber}] starting...`);
    const result = await runTick(db, config, ctx, getToolDefinitions(), executeTool);
    console.log(`[Tick #${tickNumber}] ${result.summary.slice(0, 500)}`);
    console.log(`[Tick #${tickNumber}] tool calls: ${result.toolCalls}`);

    if (result.restartRequested) {
      console.log("Self-restart requested. Exiting for supervisor restart...");
      process.exit(0);
    }
  } finally {
    runningTick = false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function startImmortalLoop(): Promise<void> {
  const config = loadConfig();

  startWakeServer(config, () => {
    wakeNow = true;
  });

  console.log("\n=== MAXIMUS CORE ONLINE ===\n");
  console.log(`Tick interval: ${config.tickIntervalMs}ms`);

  // Run first tick immediately
  await executeTick();

  while (true) {
    if (wakeNow) {
      wakeNow = false;
      await executeTick();
    }

    await sleep(1000);

    const db = openDatabase(config);
    const lastTickAt = db.prepare("SELECT value FROM meta WHERE key = 'last_tick_at'").get() as
      | { value: string }
      | undefined;
    const elapsed = lastTickAt ? Date.now() - new Date(lastTickAt.value).getTime() : Infinity;

    if (elapsed >= config.tickIntervalMs) {
      await executeTick();
    }
  }
}

export async function runSingleTick(): Promise<void> {
  await executeTick();
}

export function printStatus(): void {
  const config = loadConfig();
  const db = openDatabase(config);
  const identity = db.prepare("SELECT name, mission FROM identity WHERE id = 1").get() as
    | { name: string; mission: string }
    | undefined;
  const tick = db.prepare("SELECT value FROM meta WHERE key = 'tick_number'").get() as
    | { value: string }
    | undefined;
  const journal = listJournal(db, 3);

  console.log(JSON.stringify({ identity, tick: tick?.value ?? "0", journal }, null, 2));
}
