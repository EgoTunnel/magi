import { db, newId, nowIso } from "@/lib/db";
import { indexRemove, indexUpsert } from "@/lib/searchIndex";

export interface Skill {
  id: string;
  scope: "global" | "project";
  project_id: string | null;
  name: string;
  description: string | null;
  instructions: string;
  // Null means "no restriction beyond whatever's globally enabled" — the
  // default for every Skill created before this existed, and for anyone who
  // doesn't touch the checkboxes at creation time.
  allowed_tools: string[] | null;
  created_at: string;
}

interface SkillRow {
  id: string;
  scope: "global" | "project";
  project_id: string | null;
  name: string;
  description: string | null;
  instructions: string;
  allowed_tools: string | null;
  created_at: string;
}

function parse(row: SkillRow): Skill {
  let allowed_tools: string[] | null = null;
  if (row.allowed_tools) {
    try {
      const parsed = JSON.parse(row.allowed_tools);
      if (Array.isArray(parsed)) allowed_tools = parsed;
    } catch {
      // leave null — treat unparseable data as "no restriction"
    }
  }
  return { ...row, allowed_tools };
}

export function listSkills(opts: { projectId?: string } = {}): Skill[] {
  const rows = opts.projectId
    ? (db
        .prepare(`SELECT * FROM skills WHERE scope = 'global' OR project_id = ? ORDER BY created_at DESC`)
        .all(opts.projectId) as SkillRow[])
    : (db.prepare(`SELECT * FROM skills ORDER BY created_at DESC`).all() as SkillRow[]);
  return rows.map(parse);
}

export function getSkill(id: string): Skill | null {
  const row = db.prepare(`SELECT * FROM skills WHERE id = ?`).get(id) as SkillRow | undefined;
  return row ? parse(row) : null;
}

export function createSkill(input: {
  scope: "global" | "project";
  projectId?: string;
  name: string;
  description?: string;
  instructions: string;
  allowedTools?: string[] | null;
}): Skill {
  const id = newId("skl");
  const ts = nowIso();
  db.prepare(
    `INSERT INTO skills (id, scope, project_id, name, description, instructions, allowed_tools, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.scope,
    input.scope === "project" ? input.projectId ?? null : null,
    input.name,
    input.description ?? null,
    input.instructions,
    input.allowedTools?.length ? JSON.stringify(input.allowedTools) : null,
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
