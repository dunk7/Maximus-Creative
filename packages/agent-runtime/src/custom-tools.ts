import type Database from "better-sqlite3";
import type { ToolDefinition } from "./types.js";

export interface CustomToolRow {
  name: string;
  description: string;
  parameters_json: string;
  handler_type: "shell_template" | "fetch_template";
  handler_config: string;
  created_at: string;
}

export function ensureCustomToolsTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS custom_tools (
      name TEXT PRIMARY KEY,
      description TEXT NOT NULL,
      parameters_json TEXT NOT NULL,
      handler_type TEXT NOT NULL,
      handler_config TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

export function registerCustomTool(
  db: Database.Database,
  tool: Omit<CustomToolRow, "created_at">
): void {
  ensureCustomToolsTable(db);
  db.prepare(
    `INSERT INTO custom_tools (name, description, parameters_json, handler_type, handler_config)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(name) DO UPDATE SET
       description = excluded.description,
       parameters_json = excluded.parameters_json,
       handler_type = excluded.handler_type,
       handler_config = excluded.handler_config`
  ).run(tool.name, tool.description, tool.parameters_json, tool.handler_type, tool.handler_config);
}

export function listCustomTools(db: Database.Database): CustomToolRow[] {
  ensureCustomToolsTable(db);
  return db
    .prepare(
      "SELECT name, description, parameters_json, handler_type, handler_config, created_at FROM custom_tools"
    )
    .all() as CustomToolRow[];
}

export function getCustomToolDefinitions(db: Database.Database): ToolDefinition[] {
  return listCustomTools(db).map((row) => ({
    name: row.name,
    description: row.description,
    parameters: JSON.parse(row.parameters_json) as Record<string, unknown>,
  }));
}

export function deleteCustomTool(db: Database.Database, name: string): boolean {
  ensureCustomToolsTable(db);
  const result = db.prepare("DELETE FROM custom_tools WHERE name = ?").run(name);
  return result.changes > 0;
}
