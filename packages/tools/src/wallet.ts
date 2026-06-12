import fs from "node:fs";
import path from "node:path";
import { Keypair, Connection, LAMPORTS_PER_SOL, SystemProgram, Transaction, sendAndConfirmTransaction, PublicKey } from "@solana/web3.js";
import type { RuntimeConfig } from "@maximus/agent-runtime";

export interface WalletInfo {
  pubkey: string;
  secretKey: number[];
}

export function loadOrCreateWallet(config: RuntimeConfig): Keypair {
  fs.mkdirSync(path.dirname(config.walletPath), { recursive: true });

  if (fs.existsSync(config.walletPath)) {
    const raw = JSON.parse(fs.readFileSync(config.walletPath, "utf8")) as WalletInfo;
    return Keypair.fromSecretKey(Uint8Array.from(raw.secretKey));
  }

  const keypair = Keypair.generate();
  const info: WalletInfo = {
    pubkey: keypair.publicKey.toBase58(),
    secretKey: Array.from(keypair.secretKey),
  };
  fs.writeFileSync(config.walletPath, JSON.stringify(info, null, 2), "utf8");
  return keypair;
}

export async function getBalanceSol(config: RuntimeConfig, pubkey: string): Promise<number> {
  const connection = new Connection(config.solanaRpcUrl, "confirmed");
  const lamports = await connection.getBalance(new PublicKey(pubkey));
  return lamports / LAMPORTS_PER_SOL;
}

export async function sendSol(
  config: RuntimeConfig,
  keypair: Keypair,
  toAddress: string,
  amountSol: number
): Promise<string> {
  const connection = new Connection(config.solanaRpcUrl, "confirmed");
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: keypair.publicKey,
      toPubkey: new PublicKey(toAddress),
      lamports: Math.floor(amountSol * LAMPORTS_PER_SOL),
    })
  );

  return sendAndConfirmTransaction(connection, tx, [keypair]);
}
