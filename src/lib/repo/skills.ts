import { db, newId, nowIso } from "@/lib/db";
import { indexRemove, indexUpsert } from "@/lib/searchIndex";

// One step of a Skill's pipeline. A Skill with stages is a method with
// iteration built in — the thing the Vision means by a Skill, as opposed to a
// paragraph of instructions. Agents run these in place of their built-in
// five-stage pipeline (see src/lib/agent.ts).
export interface SkillStage {
  name: string;
  instructions: string;
  // Falls back to the Skill's own model_role, then to a sensible default —
  // a stage only names a role when it genuinely wants a different one.
  modelRole?: string | null;
  // Only stages that need to look things up get tools; the default is off, so
  // a pipeline doesn't hand every step the whole toolbox by accident.
  useTools?: boolean;
}

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
  // Which model role this method wants. Null means "whatever the caller was
  // going to use anyway", which is how every pre-existing Skill behaves.
  model_role: string | null;
  // Empty means a plain single-pass Skill.
  stages: SkillStage[];
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
  model_role: string | null;
  stages: string | null;
  created_at: string;
}

// Unparseable JSON is treated as absent rather than thrown: a Skill with a
// corrupt stage list should still work as an ordinary single-pass Skill, not
// break every conversation that selects it.
function parseJsonArray<T>(raw: string | null): T[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : null;
  } catch {
    return null;
  }
}

function parse(row: SkillRow): Skill {
  return {
    ...row,
    allowed_tools: parseJsonArray<string>(row.allowed_tools),
    stages: parseJsonArray<SkillStage>(row.stages) ?? [],
  };
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
  modelRole?: string | null;
  stages?: SkillStage[] | null;
}): Skill {
  const id = newId("skl");
  const ts = nowIso();
  db.prepare(
    `INSERT INTO skills (id, scope, project_id, name, description, instructions, allowed_tools, model_role, stages, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.scope,
    input.scope === "project" ? input.projectId ?? null : null,
    input.name,
    input.description ?? null,
    input.instructions,
    input.allowedTools?.length ? JSON.stringify(input.allowedTools) : null,
    input.modelRole || null,
    input.stages?.length ? JSON.stringify(input.stages) : null,
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

export function updateSkill(
  id: string,
  input: {
    name?: string;
    description?: string | null;
    instructions?: string;
    allowedTools?: string[] | null;
    modelRole?: string | null;
    stages?: SkillStage[] | null;
  }
): Skill | null {
  const existing = getSkill(id);
  if (!existing) return null;
  const next = {
    name: input.name ?? existing.name,
    description: input.description !== undefined ? input.description : existing.description,
    instructions: input.instructions ?? existing.instructions,
    allowedTools: input.allowedTools !== undefined ? input.allowedTools : existing.allowed_tools,
    modelRole: input.modelRole !== undefined ? input.modelRole : existing.model_role,
    stages: input.stages !== undefined ? input.stages : existing.stages,
  };
  db.prepare(
    `UPDATE skills SET name = ?, description = ?, instructions = ?, allowed_tools = ?, model_role = ?, stages = ?
     WHERE id = ?`
  ).run(
    next.name,
    next.description,
    next.instructions,
    next.allowedTools?.length ? JSON.stringify(next.allowedTools) : null,
    next.modelRole || null,
    next.stages?.length ? JSON.stringify(next.stages) : null,
    id
  );
  indexUpsert({
    kind: "skill",
    refId: id,
    projectId: existing.project_id,
    title: next.name,
    content: `${next.description ?? ""}\n${next.instructions}`,
  });
  return getSkill(id);
}

export function deleteSkill(id: string) {
  db.prepare(`DELETE FROM skills WHERE id = ?`).run(id);
  indexRemove("skill", id);
}
