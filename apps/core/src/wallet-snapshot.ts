import { fetchWalletSnapshot, loadConfig, type RuntimeConfig, type WalletSnapshot } from "@maximus/agent-runtime";
import { getBalanceSol, getWalletPubkey } from "@maximus/tools";

const WALLET_CACHE_TTL_MS = Number(process.env.WALLET_CACHE_TTL_MS ?? 45_000);

let cached: { pubkey: string; balanceSol: number | null; at: number } | null = null;

export async function loadWalletSnapshot(config: RuntimeConfig = loadConfig()): Promise<WalletSnapshot> {
  const pubkey = getWalletPubkey(config);
  if (!pubkey) return { pubkey: null, balanceSol: null };

  const now = Date.now();
  if (cached && cached.pubkey === pubkey && now - cached.at < WALLET_CACHE_TTL_MS) {
    return { pubkey, balanceSol: cached.balanceSol };
  }

  const snapshot = await fetchWalletSnapshot((pk) => getBalanceSol(config, pk), pubkey);
  cached = { pubkey, balanceSol: snapshot.balanceSol, at: now };
  return snapshot;
}
