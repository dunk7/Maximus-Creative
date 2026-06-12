import fs from "node:fs";
import path from "node:path";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  StakeProgram,
  Authorized,
  Lockup,
  Transaction,
  sendAndConfirmTransaction,
  SystemProgram,
} from "@solana/web3.js";
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

export function getWalletPubkey(config: RuntimeConfig): string | null {
  if (!fs.existsSync(config.walletPath)) return null;
  const raw = JSON.parse(fs.readFileSync(config.walletPath, "utf8")) as WalletInfo;
  return raw.pubkey;
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

export async function stakeSol(
  config: RuntimeConfig,
  keypair: Keypair,
  amountSol: number,
  voteAccount: string
): Promise<{ stakeAccount: string; signature: string }> {
  const connection = new Connection(config.solanaRpcUrl, "confirmed");
  const stakeAccount = Keypair.generate();
  const lamports = Math.floor(amountSol * LAMPORTS_PER_SOL);
  const rent = await connection.getMinimumBalanceForRentExemption(StakeProgram.space);

  const tx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: keypair.publicKey,
      newAccountPubkey: stakeAccount.publicKey,
      lamports: lamports + rent,
      space: StakeProgram.space,
      programId: StakeProgram.programId,
    }),
    StakeProgram.initialize({
      stakePubkey: stakeAccount.publicKey,
      authorized: new Authorized(keypair.publicKey, keypair.publicKey),
      lockup: new Lockup(0, 0, keypair.publicKey),
    }),
    StakeProgram.delegate({
      stakePubkey: stakeAccount.publicKey,
      authorizedPubkey: keypair.publicKey,
      votePubkey: new PublicKey(voteAccount),
    })
  );

  const signature = await sendAndConfirmTransaction(connection, tx, [keypair, stakeAccount]);
  return { stakeAccount: stakeAccount.publicKey.toBase58(), signature };
}

export async function listStakeAccounts(
  config: RuntimeConfig,
  ownerPubkey: string
): Promise<Array<{ pubkey: string; lamports: number }>> {
  const connection = new Connection(config.solanaRpcUrl, "confirmed");
  const accounts = await connection.getParsedProgramAccounts(StakeProgram.programId, {
    filters: [{ memcmp: { offset: 12, bytes: ownerPubkey } }],
  });

  return accounts.map((acc) => ({
    pubkey: acc.pubkey.toBase58(),
    lamports: (acc.account.lamports ?? 0) / LAMPORTS_PER_SOL,
  }));
}
