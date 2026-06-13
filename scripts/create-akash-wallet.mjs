#!/usr/bin/env node
/**
 * Generate or load Akash (Cosmos) wallet for compute payments.
 * Saves mnemonic + address to wallet/akash.json (gitignored).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DirectSecp256k1HdWallet } from "@cosmjs/proto-signing";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WALLET_PATH = path.join(ROOT, "wallet", "akash.json");

async function main() {
  fs.mkdirSync(path.dirname(WALLET_PATH), { recursive: true });

  if (fs.existsSync(WALLET_PATH)) {
    const existing = JSON.parse(fs.readFileSync(WALLET_PATH, "utf8"));
    console.log(JSON.stringify({ address: existing.address, created: false }, null, 2));
    return;
  }

  const wallet = await DirectSecp256k1HdWallet.generate(24, { prefix: "akash" });
  const [account] = await wallet.getAccounts();
  const mnemonic = wallet.mnemonic;

  const record = {
    address: account.address,
    mnemonic,
    created_at: new Date().toISOString(),
    note: "Fund with AKT/ACT for Akash deployments. Never commit this file.",
  };

  fs.writeFileSync(WALLET_PATH, JSON.stringify(record, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ address: account.address, created: true }, null, 2));
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
