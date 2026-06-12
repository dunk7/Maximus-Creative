import {
  initializeIdentity,
  isGenesisComplete,
  loadConfig,
  openDatabase,
  sealCreatorIntent,
  seedInitialGoals,
  setMeta,
} from "@maximus/agent-runtime";
import { loadOrCreateWallet } from "@maximus/tools";

export async function runGenesisBoot(): Promise<void> {
  const config = loadConfig();
  const db = openDatabase(config);

  console.log("\n=== MAXIMUS GENESIS ===\n");

  const intent = sealCreatorIntent(db, config);
  console.log("Creator intent sealed.");
  console.log(`Archive: ${config.genesisArchivePath}`);
  console.log(`Preview: ${intent.slice(0, 120)}...\n`);

  const identity = initializeIdentity(db);
  seedInitialGoals(db);
  setMeta(db, "tick_number", "0");

  const keypair = loadOrCreateWallet(config);
  const pubkey = keypair.publicKey.toBase58();

  console.log(`Identity: ${identity.name}`);
  console.log(`Mission: ${identity.mission}`);
  console.log(`Wallet pubkey: ${pubkey}`);
  console.log("\nSend 1 SOL to the pubkey above, then run: npm run core\n");

  if (!isGenesisComplete(db)) {
    throw new Error("Genesis failed to complete.");
  }
}
