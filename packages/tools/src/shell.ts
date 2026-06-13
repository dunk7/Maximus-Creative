import { spawn } from "node:child_process";
import type Database from "better-sqlite3";
import {
  isCreativePrivilegedShellCommand,
  isHardBlockedShell,
  requiresShellApproval,
  shellTimeoutForCommand,
  validateShellAgainstGoals,
  type RuntimeConfig,
  type UserRole,
} from "@maximus/agent-runtime";

function runShellAsync(command: string, cwd: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn(command, {
      shell: true,
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    const maxBytes = 1024 * 1024;

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      resolve(`Command timed out after ${timeoutMs}ms`);
    }, timeoutMs);

    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
      if (stdout.length > maxBytes) child.kill("SIGTERM");
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
      if (stderr.length > maxBytes) child.kill("SIGTERM");
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout || "(no output)");
      else resolve(stderr || stdout || `Exit code ${code}`);
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve(err.message || "Shell command failed");
    });
  });
}

export async function executeShellWithGuardrails(
  config: RuntimeConfig,
  db: Database.Database,
  command: string,
  cwd: string,
  agentReason?: string,
  role: UserRole = "creative"
): Promise<string> {
  if (isHardBlockedShell(command)) {
    return "Blocked: command is irreversibly dangerous and cannot be approved.";
  }

  const c = command.toLowerCase().trim();
  if (role === "creative" && !/\bsudo\b/.test(c)) {
    const output = await runShellAsync(command, cwd, shellTimeoutForCommand(command, role));
    const label = isCreativePrivilegedShellCommand(command) ? "Creative privileged" : "Creative shell";
    return `[${label}]\n${output}`;
  }

  if (requiresShellApproval(command, role)) {
    const verdict = await validateShellAgainstGoals(config, db, command, agentReason);
    if (!verdict.approved) {
      const goals =
        verdict.relatedGoalIds.length > 0
          ? ` (reviewed goals: ${verdict.relatedGoalIds.join(", ")})`
          : "";
      return `Shell command rejected by goal reviewer${goals}: ${verdict.rationale}`;
    }

    const timeout = shellTimeoutForCommand(command, role);
    const output = await runShellAsync(command, cwd, timeout);
    const goalNote =
      verdict.relatedGoalIds.length > 0
        ? ` Goals #${verdict.relatedGoalIds.join(", #")}.`
        : "";
    return `[Goal-approved:${goalNote} ${verdict.rationale}]\n${output}`;
  }

  return runShellAsync(command, cwd, shellTimeoutForCommand(command, role));
}
