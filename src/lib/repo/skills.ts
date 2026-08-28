import { db, newId, nowIso } from "@/lib/db";
import { indexRemove, indexUpsert } from "@/lib/searchIndex";

export interface Skill {
  id: string;
  scope: "global" | "project";
  project_id: string | null;
  name: string;
  description: string | null;
  instructions: string;
  created_at: string;
}

export function listSkills(opts: { projectId?: string } = {}): Skill[] {
  if (opts.projectId) {
    return db
      .prepare(
        `SELECT * FROM skills WHERE scope = 'global' OR project_id = ? ORDER BY created_at DESC`
      )
      .all(opts.projectId) as Skill[];
  }
  return db.prepare(`SELECT * FROM skills ORDER BY created_at DESC`).all() as Skill[];
}

export function getSkill(id: string): Skill | null {
  return (db.prepare(`SELECT * FROM skills WHERE id = ?`).get(id) as Skill) ?? null;
}

export function createSkill(input: {
  scope: "global" | "project";
  projectId?: string;
  name: string;
  description?: string;
  instructions: string;
}): Skill {
  const id = newId("skl");
  const ts = nowIso();
  db.prepare(
    `INSERT INTO skills (id, scope, project_id, name, description, instructions, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.scope,
    input.scope === "project" ? input.projectId ?? null : null,
    input.name,
    input.description ?? null,
    input.instructions,
    ts
  );
  indexUpsert({
    kind: "skill",
    refId: id,
    projectId: input.scope === "project" ? input.projectId ?? null : null,
    title: input.name,
    content: `${input.description ?? ""}\n${input.instructions}`,
  });
  return getSkill(id)!;
}

export function deleteSkill(id: string) {
  db.prepare(`DELETE FROM skills WHERE id = ?`).run(id);
  indexRemove("skill", id);
}
