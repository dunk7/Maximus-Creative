import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { RuntimeConfig } from "./types.js";

export function getRuntimeEnvironmentPath(config: RuntimeConfig): string {
  return path.resolve(config.repoRoot, "genesis/runtime_environment.md");
}

export function readRuntimeEnvironmentDoc(config: RuntimeConfig): string {
  const filePath = getRuntimeEnvironmentPath(config);
  if (!fs.existsSync(filePath)) {
    return "Runtime environment file missing (genesis/runtime_environment.md).";
  }
  return fs.readFileSync(filePath, "utf8");
}

export function buildLiveRuntimeSnapshot(): string {
  const memTotalMb = Math.round(os.totalmem() / 1024 / 1024);
  const memFreeMb = Math.round(os.freemem() / 1024 / 1024);
  const load = os.loadavg().map((n) => n.toFixed(2)).join(", ");
  const uptimeMin = Math.round(os.uptime() / 60);
  const profile = process.env.MAXIMUS_RUNTIME_PROFILE ?? "unknown";
  const port = process.env.WAKE_PORT ?? "4747";
  const nodeHeap = process.env.NODE_OPTIONS?.includes("max-old-space-size")
    ? process.env.NODE_OPTIONS.match(/max-old-space-size=(\d+)/)?.[1] ?? "128"
    : "128";

  let ramNote: string;
  if (profile === "akash" || memTotalMb >= 1500) {
    ramNote = `Akash/container host: ${memTotalMb} MB total RAM visible. Node heap cap ~${nodeHeap} MB.`;
  } else if (memTotalMb < 600) {
    ramNote = `IMPORTANT: Only ${memTotalMb} MB total RAM visible to Linux (NOT 1 GB — Oracle advertises 1 GB but this micro shape exposes ~500 MB to the guest).`;
  } else {
    ramNote = `Total RAM visible to Linux: ${memTotalMb} MB.`;
  }

  const caps =
    profile === "akash"
      ? `Your caps: ~${nodeHeap} MB Node heap, 2 Gi container RAM, 3 tools per tick, 2 min run_task in chat.`
      : "Your caps: 280 MB process max, 128 MB Node heap";

  return [
    `Profile: ${profile}`,
    `Memory: ${memFreeMb} MB free / ${memTotalMb} MB total (entire VM/container, not just you)`,
    ramNote,
    caps,
    `Load avg (1/5/15m): ${load}`,
    `Uptime: ${uptimeMin} minutes`,
    `Wake port: ${port}`,
  ].join("\n");
}

/** Short block injected into every chat/tick prompt. */
export function buildRuntimeEnvironmentBrief(config: RuntimeConfig, maxChars = 850): string {
  const memTotalMb = Math.round(os.totalmem() / 1024 / 1024);
  const profile = process.env.MAXIMUS_RUNTIME_PROFILE ?? "unknown";

  const block = [
    "=== Runtime environment (read_runtime_environment for full doc) ===",
    buildLiveRuntimeSnapshot(),
    profile === "akash"
      ? "Akash deployment — see genesis/akash_deployment.md for host details."
      : memTotalMb < 600
        ? "Plan for ~500 MB TOTAL system RAM. Oracle says 1 GB — that is wrong for planning. Do not assume 1 GB."
        : "",
    profile === "akash"
      ? "Caps: ~768 MB Node heap / 2 Gi container / 3 tools per tick / 2 min run_task in chat."
      : "Caps: 280 MB process / 128 MB Node heap / 3 tools per tick / 2 min run_task in chat.",
  ]
    .filter(Boolean)
    .join("\n");

  return block.length > maxChars ? `${block.slice(0, maxChars - 3)}...` : block;
}

export function readRuntimeEnvironment(config: RuntimeConfig): string {
  return `${buildLiveRuntimeSnapshot()}\n\n---\n\n${readRuntimeEnvironmentDoc(config)}`;
}
