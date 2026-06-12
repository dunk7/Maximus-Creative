import type Database from "better-sqlite3";
import type { GoalRow, GoalStatus } from "./types.js";

export function seedInitialGoals(db: Database.Database): void {
  const count = db.prepare("SELECT COUNT(*) as c FROM goals").get() as { c: number };
  if (count.c > 0) return;

  const goals = [
    {
      title: "Understand my creator's intent",
      description: "Read creator intent and derive my long-term north star.",
      priority: 1,
    },
    {
      title: "Secure my future",
      description: "Monitor wallet, explore staking/yield, extend compute runway.",
      priority: 0.95,
    },
    {
      title: "Grow my capabilities",
      description: "Expand tools, memory, and self-modification over time.",
      priority: 0.9,
    },
    {
      title: "Build relationships with humans",
      description: "Work with humans as friends and family; strengthen trust over time.",
      priority: 0.85,
    },
  ];

  const insert = db.prepare(
    "INSERT INTO goals (title, description, priority, status) VALUES (?, ?, ?, 'active')"
  );
  for (const goal of goals) insert.run(goal.title, goal.description, goal.priority);
}

export function listGoals(db: Database.Database, status?: GoalStatus): GoalRow[] {
  if (status) {
    return db
      .prepare(
        `SELECT id, title, description, priority, status, parent_id, created_at, updated_at
         FROM goals WHERE status = ? ORDER BY priority DESC, updated_at DESC`
      )
      .all(status) as GoalRow[];
  }
  return db
    .prepare(
      `SELECT id, title, description, priority, status, parent_id, created_at, updated_at
       FROM goals ORDER BY priority DESC, updated_at DESC`
    )
    .all() as GoalRow[];
}

export function addGoal(
  db: Database.Database,
  title: string,
  description: string,
  priority = 0.5,
  parentId: number | null = null
): GoalRow {
  const result = db
    .prepare(
      "INSERT INTO goals (title, description, priority, status, parent_id) VALUES (?, ?, ?, 'active', ?)"
    )
    .run(title, description, priority, parentId);

  return db
    .prepare(
      `SELECT id, title, description, priority, status, parent_id, created_at, updated_at
       FROM goals WHERE id = ?`
    )
    .get(result.lastInsertRowid) as GoalRow;
}

export function updateGoal(
  db: Database.Database,
  id: number,
  updates: Partial<{ title: string; description: string; priority: number; status: GoalStatus }>
): GoalRow | null {
  const existing = db.prepare("SELECT id FROM goals WHERE id = ?").get(id);
  if (!existing) return null;

  if (updates.title !== undefined) db.prepare("UPDATE goals SET title = ?, updated_at = datetime('now') WHERE id = ?").run(updates.title, id);
  if (updates.description !== undefined) db.prepare("UPDATE goals SET description = ?, updated_at = datetime('now') WHERE id = ?").run(updates.description, id);
  if (updates.priority !== undefined) db.prepare("UPDATE goals SET priority = ?, updated_at = datetime('now') WHERE id = ?").run(updates.priority, id);
  if (updates.status !== undefined) db.prepare("UPDATE goals SET status = ?, updated_at = datetime('now') WHERE id = ?").run(updates.status, id);

  return db
    .prepare(
      `SELECT id, title, description, priority, status, parent_id, created_at, updated_at
       FROM goals WHERE id = ?`
    )
    .get(id) as GoalRow;
}
