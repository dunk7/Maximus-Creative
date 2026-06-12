const LOCK_STALE_MS = 10 * 60 * 1000;
const DEFAULT_MAX_WAIT_MS = 120_000;
/** Chat/HTTP handlers must not hang — return 503 after this wait. */
export const CHAT_LOCK_MAX_WAIT_MS = 30_000;

let locked = false;
let lockedAt = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Force-release a stuck lock (e.g. after tick timeout). */
export function forceReleaseAgentLock(reason: string): void {
  if (!locked) return;
  console.warn(`[AgentLock] Force releasing stale lock: ${reason}`);
  locked = false;
  lockedAt = 0;
}

export function isAgentLocked(): boolean {
  return locked;
}

export async function withAgentLock<T>(
  fn: () => Promise<T>,
  opts?: { maxWaitMs?: number }
): Promise<T> {
  const maxWaitMs = opts?.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
  const waitStart = Date.now();

  while (locked) {
    if (Date.now() - lockedAt > LOCK_STALE_MS) {
      forceReleaseAgentLock("held longer than stale threshold");
      break;
    }
    if (Date.now() - waitStart > maxWaitMs) {
      throw new Error("Agent busy — try again in a moment");
    }
    await sleep(250);
  }

  locked = true;
  lockedAt = Date.now();
  try {
    return await fn();
  } finally {
    locked = false;
    lockedAt = 0;
  }
}
