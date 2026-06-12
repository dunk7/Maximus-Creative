/** Minimum tick interval — prevents API/VM meltdown from 10s ticks. */
export const MIN_TICK_INTERVAL_MS = 60_000;

/** Sane default for 1GB Oracle micro VM. */
export const DEFAULT_TICK_INTERVAL_MS = 1_800_000;

export const PROTECTED_EDIT_PATHS = [
  "package.json",
  "package-lock.json",
  ".env",
  "apps/core/src/wake-server.ts",
  "apps/core/src/loop.ts",
  "apps/core/src/agent-lock.ts",
  "packages/agent-runtime/src/db.ts",
  "packages/agent-runtime/src/llm.ts",
  "packages/agent-runtime/src/conversation.ts",
  "packages/agent-runtime/src/guardrails.ts",
  "apps/core/src/chat-page.ts",
  "apps/core/src/repair.ts",
];

export function clampTickIntervalMs(ms: number): number {
  if (!Number.isFinite(ms) || ms < MIN_TICK_INTERVAL_MS) return DEFAULT_TICK_INTERVAL_MS;
  return Math.floor(ms);
}

export function isProtectedEditPath(relPath: string): boolean {
  const normalized = relPath.replace(/\\/g, "/").replace(/^\.\//, "");
  return PROTECTED_EDIT_PATHS.some(
    (p) => normalized === p || normalized.endsWith(`/${p}`)
  );
}

/** Irreversibly dangerous — never run, even with goal-review approval. */
export function isHardBlockedShell(command: string): boolean {
  const c = command.toLowerCase().trim();
  if (!c) return true;
  const hard = [
    /\brm\s+-rf\s+\//,
    /\bdd\s+if=/,
    /\bmkfs\b/,
    /\bshutdown\b/,
    /\breboot\b/,
    /\bhalt\b/,
    /\bsystemctl\s+(stop|restart|disable)\s+maximus\b/,
    /\bkillall\s+node\b/,
    /\bpkill\s+-9\s+node\b/,
    /\bkill\s+-9\b/,
    /\bcurl\s+.*\|\s*(ba)?sh\b/,
    /\bwget\s+.*\|\s*(ba)?sh\b/,
  ];
  return hard.some((re) => re.test(c));
}

/** Privileged or heavy commands — allowed only after secondary goal-review LLM approval. */
export function requiresShellApproval(command: string): boolean {
  if (isHardBlockedShell(command)) return false;
  const c = command.toLowerCase().trim();
  if (/\bsudo\b/.test(c)) return true;
  return isBlockedShellCommand(command);
}

/** Shell commands that freeze the 1GB VM / block the HTTP server. */
export function isBlockedShellCommand(command: string): boolean {
  const c = command.toLowerCase().trim();
  if (!c) return true;
  const blocked = [
    /\bnpm\s+(run\s+)?build\b/,
    /\bnpm\s+run\b/,
    /\bnpm\s+install\b/,
    /\bnpm\s+ci\b/,
    /\bnpm\s+exec\b/,
    /\bnpx\s+/,
    /\btsc\b/,
    /\btsx\b/,
    /\bnode\s+.*\bbuild\b/,
    /\bnext\s+build\b/,
    /\bvite\s+build\b/,
    /\bwebpack\b/,
    /\bcargo\s+build\b/,
    /\brustc\b/,
    /\bmake\b/,
    /\bgcc\b/,
    /\bg\+\+/,
    /\bdnf\s+install\b/,
    /\byum\s+install\b/,
    /\bapt(-get)?\s+install\b/,
    /\bsystemctl\s+(stop|restart|disable)\s+maximus\b/,
    /\bkillall\s+node\b/,
    /\bpkill\s+-9\s+node\b/,
    /\bkill\s+-9\b/,
    /\bgit\s+clone\b/,
    /\bgit\s+pull\b/,
    /\bgit\s+fetch\b/,
    /\bcurl\s+.*\|\s*(ba)?sh\b/,
    /\bwget\s+.*\|\s*(ba)?sh\b/,
  ];
  return blocked.some((re) => re.test(c));
}

/** Max wall time for run_shell — keeps chat/health responsive. */
export const SHELL_TIMEOUT_MS = 45_000;

/** Longer timeout for approved installs / package managers. */
export const SHELL_INSTALL_TIMEOUT_MS = 300_000;

export function shellTimeoutForCommand(command: string): number {
  const c = command.toLowerCase();
  if (
    /\b(apt|apt-get|dnf|yum|brew|pip3?|npm|snap)\s+install\b/.test(c) ||
    /\bnpm\s+ci\b/.test(c) ||
    /\bsudo\b/.test(c)
  ) {
    return SHELL_INSTALL_TIMEOUT_MS;
  }
  if (requiresShellApproval(command)) return SHELL_INSTALL_TIMEOUT_MS;
  return SHELL_TIMEOUT_MS;
}
