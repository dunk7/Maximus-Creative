import { spawn } from "node:child_process";
import type Database from "better-sqlite3";
import { SHELL_TIMEOUT_MS, type CustomToolRow } from "@maximus/agent-runtime";

export function interpolateShellCommand(template: string, args: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const value = args[key];
    return value == null ? "" : String(value);
  });
}

export async function executeCustomTool(
  row: CustomToolRow,
  args: Record<string, unknown>,
  repoRoot: string
): Promise<string> {
  const config = JSON.parse(row.handler_config) as Record<string, string>;

  if (row.handler_type === "shell_template") {
    const command = interpolateShellCommand(config.command ?? "", args);
    return new Promise((resolve) => {
      const child = spawn(command, { shell: true, cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        resolve(`Command timed out after ${SHELL_TIMEOUT_MS}ms`);
      }, SHELL_TIMEOUT_MS);
      child.stdout?.on("data", (chunk) => {
        stdout += chunk.toString();
        if (stdout.length > 1024 * 1024) child.kill("SIGTERM");
      });
      child.on("close", () => {
        clearTimeout(timer);
        resolve(stdout || "(no output)");
      });
      child.on("error", (err) => {
        clearTimeout(timer);
        resolve(err.message || "Shell failed");
      });
    });
  }

  if (row.handler_type === "fetch_template") {
    const url = interpolateShellCommand(config.url ?? "", args);
    const res = await fetch(url, {
      headers: config.headers ? (JSON.parse(config.headers) as Record<string, string>) : undefined,
    });
    const text = await res.text();
    return text.slice(0, 50000);
  }

  return `Unsupported handler type: ${row.handler_type}`;
}

export function findCustomTool(
  db: Database.Database,
  name: string
): CustomToolRow | null {
  const row = db
    .prepare(
      "SELECT name, description, parameters_json, handler_type, handler_config, created_at FROM custom_tools WHERE name = ?"
    )
    .get(name) as CustomToolRow | undefined;
  return row ?? null;
}
