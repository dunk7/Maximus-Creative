#!/usr/bin/env node
/**
 * Swap SOL → AKT without API keys:
 *   1. Jupiter (lite-api.jup.ag) — SOL → USDC on Solana
 *   2. Skip Go (api.skip.build) — USDC → uakt on Akash via CCTP + IBC
 *
 * Usage:
 *   node scripts/swap-sol-to-akt.mjs [amount_sol]          # execute
 *   node scripts/swap-sol-to-akt.mjs --quote-only [amount] # quote only
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  VersionedTransaction,
} from "@solana/web3.js";
import { DirectSecp256k1HdWallet } from "@cosmjs/proto-signing";
import { executeRoute, route, setClientOptions } from "@skip-go/client";

setClientOptions({});

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENV_PATH = path.join(ROOT, ".env");
const SOL_WALLET = path.join(ROOT, "wallet", "agent.json");
const AKT_WALLET = path.join(ROOT, "wallet", "akash.json");
const STATUS_PATH = path.join(ROOT, "data", "migration", "skip-swap.json");

const SOL_MINT = "So11111111111111111111111111111111111111112";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDC_DECIMALS = 6;
const RESERVE_SOL = 0.05;

const COSMOS_PREFIXES = {
  "akashnet-2": "akash",
  "noble-1": "noble",
  "osmosis-1": "osmo",
};

function loadEnv() {
  if (!fs.existsSync(ENV_PATH)) return {};
  const out = {};
  for (const line of fs.readFileSync(ENV_PATH, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 1) continue;
    out[t.slice(0, i)] = t.slice(i + 1).replace(/^["']|["']$/g, "");
  }
  return out;
}

function parseArgs(argv) {
  const quoteOnly = argv.includes("--quote-only");
  const bridgeOnly = argv.includes("--bridge-only");
  const amountArg = argv.find((a) => !a.startsWith("-"));
  return { quoteOnly, bridgeOnly, amountArg };
}

async function deriveCosmosAddresses(mnemonic) {
  const out = {};
  for (const [chainId, prefix] of Object.entries(COSMOS_PREFIXES)) {
    const wallet = await DirectSecp256k1HdWallet.fromMnemonic(mnemonic, { prefix });
    const [account] = await wallet.getAccounts();
    out[chainId] = account.address;
  }
  return out;
}

function makeSvmAdapter(keypair) {
  return {
    publicKey: keypair.publicKey,
    connected: true,
    connecting: false,
    disconnecting: false,
    readyState: "Installed",
    name: "MaximusKeypair",
    url: "https://maximus.local",
    icon: "",
    supportedTransactionVersions: new Set(["legacy", 0]),
    signTransaction: async (tx) => {
      if (tx instanceof VersionedTransaction) {
        tx.sign([keypair]);
      } else {
        tx.partialSign(keypair);
      }
      return tx;
    },
    signAllTransactions: async (txs) => {
      for (const tx of txs) {
        if (tx instanceof VersionedTransaction) {
          tx.sign([keypair]);
        } else {
          tx.partialSign(keypair);
        }
      }
      return txs;
    },
    signMessage: async () => {
      throw new Error("signMessage not supported");
    },
    connect: async () => {},
    disconnect: async () => {},
    sendTransaction: async () => {
      throw new Error("sendTransaction not used — Skip broadcasts via /v2/tx/submit");
    },
  };
}

async function jupiterQuote(lamports, slippageBps = 100) {
  const url = new URL("https://lite-api.jup.ag/swap/v1/quote");
  url.searchParams.set("inputMint", SOL_MINT);
  url.searchParams.set("outputMint", USDC_MINT);
  url.searchParams.set("amount", String(lamports));
  url.searchParams.set("slippageBps", String(slippageBps));
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Jupiter quote failed: ${await res.text()}`);
  return res.json();
}

async function jupiterSwap(quoteResponse, userPublicKey) {
  const res = await fetch("https://lite-api.jup.ag/swap/v1/swap", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      quoteResponse,
      userPublicKey,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: "auto",
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Jupiter swap failed (${res.status}): ${text}`);
  return JSON.parse(text);
}

async function getUsdcBalance(connection, owner) {
  const accounts = await connection.getParsedTokenAccountsByOwner(owner, {
    mint: new PublicKey(USDC_MINT),
  });
  let total = 0n;
  for (const { account } of accounts.value) {
    const amount = account.data.parsed?.info?.tokenAmount?.amount;
    if (amount) total += BigInt(amount);
  }
  return total;
}

async function waitForUsdc(connection, owner, minAmount, timeoutMs = 120_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const bal = await getUsdcBalance(connection, owner);
    if (bal >= minAmount) return bal;
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error(`Timed out waiting for USDC balance (need ${minAmount})`);
}

async function skipRouteQuote(usdcAmountMicro) {
  const routeResult = await route({
    amountIn: String(usdcAmountMicro),
    sourceAssetDenom: USDC_MINT,
    sourceAssetChainId: "solana",
    destAssetDenom: "uakt",
    destAssetChainId: "akashnet-2",
    allowMultiTx: true,
    allowSwaps: true,
    smartSwapOptions: { splitRoutes: true },
  });
  return routeResult;
}

async function executeSkipBridge(routeResult, cosmosAddresses, solAddress, mnemonic, solKeypair) {
  const mnemonicWallets = new Map();
  const userAddresses = routeResult.requiredChainAddresses.map((chainId) => {
    if (chainId === "solana") return { chainId, address: solAddress };
    const addr = cosmosAddresses[chainId];
    if (!addr) throw new Error(`Missing address for chain ${chainId}`);
    return { chainId, address: addr };
  });

  const txLog = [];

  await executeRoute({
    route: routeResult,
    userAddresses,
    slippageTolerancePercent: "2",
    simulate: true,
    getSvmSigner: async () => makeSvmAdapter(solKeypair),
    getCosmosSigner: async (chainId) => {
      const prefix = COSMOS_PREFIXES[chainId];
      if (!prefix) throw new Error(`Unsupported cosmos chain: ${chainId}`);
      if (!mnemonicWallets.has(chainId)) {
        mnemonicWallets.set(
          chainId,
          await DirectSecp256k1HdWallet.fromMnemonic(mnemonic, { prefix })
        );
      }
      return mnemonicWallets.get(chainId);
    },
    onTransactionBroadcast: async ({ chainId, txHash }) => {
      console.log(`  Skip broadcast ${chainId}: ${txHash}`);
      txLog.push({ chainId, txHash, phase: "broadcast" });
    },
    onTransactionCompleted: async ({ chainId, txHash, status }) => {
      console.log(`  Skip completed ${chainId}: ${txHash} (${status?.state ?? "done"})`);
      txLog.push({ chainId, txHash, phase: "completed", state: status?.state });
    },
    onValidateGasBalance: async (v) => {
      if (v.status === "error") {
        console.warn(`  Gas warning chain=${v.chainId} tx=${v.txIndex}: ${v.error ?? "insufficient"}`);
      }
    },
  });

  return txLog;
}

async function main() {
  const env = loadEnv();
  const { quoteOnly, bridgeOnly, amountArg } = parseArgs(process.argv.slice(2));
  const amountSol = Number(amountArg ?? env.SWAP_SOL_AMOUNT ?? "0.15");

  if (!fs.existsSync(AKT_WALLET)) {
    throw new Error("Missing wallet/akash.json — run: node scripts/create-akash-wallet.mjs");
  }
  if (!fs.existsSync(SOL_WALLET)) {
    throw new Error("Missing wallet/agent.json");
  }
  if (!Number.isFinite(amountSol) || amountSol <= 0) {
    throw new Error("amount_sol must be a positive number");
  }

  const akt = JSON.parse(fs.readFileSync(AKT_WALLET, "utf8"));
  const solRaw = JSON.parse(fs.readFileSync(SOL_WALLET, "utf8"));
  const keypair = Keypair.fromSecretKey(Uint8Array.from(solRaw.secretKey));
  const solAddress = keypair.publicKey.toBase58();
  const rpc = env.SOLANA_RPC_URL || process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
  const connection = new Connection(rpc, "confirmed");

  const balance = await connection.getBalance(keypair.publicKey);
  const balanceSol = balance / LAMPORTS_PER_SOL;
  if (!bridgeOnly) {
    const needed = amountSol + RESERVE_SOL;
    if (balanceSol < needed) {
      throw new Error(`Insufficient SOL: have ${balanceSol.toFixed(4)}, need ~${needed.toFixed(4)} (${amountSol} swap + ${RESERVE_SOL} reserve)`);
    }
  }

  const cosmosAddresses = await deriveCosmosAddresses(akt.mnemonic);
  const lamports = Math.floor(amountSol * LAMPORTS_PER_SOL);

  console.log(`Wallet SOL: ${balanceSol.toFixed(4)}`);
  console.log(`Akash dest: ${akt.address}`);
  console.log(`Noble: ${cosmosAddresses["noble-1"]}`);
  console.log(`Osmosis: ${cosmosAddresses["osmosis-1"]}`);
  console.log("");

  console.log(`Step 1 quote — Jupiter SOL → USDC (${amountSol} SOL)`);
  const jupQuote = await jupiterQuote(lamports);
  const usdcOut = Number(jupQuote.outAmount);
  console.log(`  ~${(usdcOut / 10 ** USDC_DECIMALS).toFixed(4)} USDC (impact ${jupQuote.priceImpactPct ?? "?"}%)`);

  console.log("");
  console.log(`Step 2 quote — Skip USDC → AKT`);
  const skipQuote = await skipRouteQuote(usdcOut);
  const aktOut = Number(skipQuote.estimatedAmountOut ?? skipQuote.amountOut ?? 0);
  console.log(`  ~${(aktOut / 1_000_000).toFixed(4)} AKT (${skipQuote.txsRequired ?? "?"} txs, ${(skipQuote.estimatedRouteDurationSeconds ?? 0) / 60} min est.)`);
  console.log(`  Route chains: ${(skipQuote.chainIds ?? skipQuote.requiredChainAddresses ?? []).join(" → ")}`);

  if (quoteOnly) {
    console.log("");
    console.log("Quote only — pass without --quote-only to execute.");
    return;
  }

  let jupSig = null;
  let usdcMicro;

  if (bridgeOnly) {
    const usdcBal = await getUsdcBalance(connection, keypair.publicKey);
    if (usdcBal <= 0n) throw new Error("No USDC balance — run full swap first");
    usdcMicro = Number(usdcBal);
    console.log(`Bridge only — using ${(usdcMicro / 10 ** USDC_DECIMALS).toFixed(6)} USDC on Solana`);
  } else {
    console.log("");
    console.log("Executing step 1 — Jupiter swap...");
    const swapPayload = await jupiterSwap(jupQuote, solAddress);
    const vtx = VersionedTransaction.deserialize(Buffer.from(swapPayload.swapTransaction, "base64"));
    vtx.sign([keypair]);
    jupSig = await connection.sendRawTransaction(vtx.serialize(), {
      skipPreflight: false,
      maxRetries: 3,
    });
    await connection.confirmTransaction(jupSig, "confirmed");
    console.log(`  Jupiter tx: https://solscan.io/tx/${jupSig}`);

    const minUsdc = BigInt(Math.floor(usdcOut * 0.97));
    console.log("Waiting for USDC settlement...");
    const usdcBal = await waitForUsdc(connection, keypair.publicKey, minUsdc);
    usdcMicro = Number(usdcBal);
    console.log(`  USDC balance: ${(usdcMicro / 10 ** USDC_DECIMALS).toFixed(6)}`);
  }

  console.log("");
  console.log("Executing step 2 — Skip bridge USDC → AKT...");
  const bridgeRoute = await skipRouteQuote(usdcMicro);
  const txLog = await executeSkipBridge(
    bridgeRoute,
    cosmosAddresses,
    solAddress,
    akt.mnemonic,
    keypair
  );

  fs.mkdirSync(path.dirname(STATUS_PATH), { recursive: true });
  const record = {
    at: new Date().toISOString(),
    amountSol,
    usdcMicro,
    aktEstimate: bridgeRoute.estimatedAmountOut ?? bridgeRoute.amountOut,
    akashAddress: akt.address,
    jupiterTx: jupSig,
    skipTxs: txLog,
  };
  fs.writeFileSync(STATUS_PATH, JSON.stringify(record, null, 2));
  console.log("");
  console.log(`Done. Status saved: ${STATUS_PATH}`);
  console.log(`AKT arrives at ${akt.address} — mint ACT in Akash Console when balance shows.`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
