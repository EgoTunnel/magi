import { db, newId, nowIso } from "@/lib/db";
import { indexUpsert, indexRemove } from "@/lib/searchIndex";

export interface Project {
  id: string;
  name: string;
  tagline: string | null;
  purpose: string | null;
  instructions: string | null;
  status: "active" | "archived";
  created_at: string;
  updated_at: string;
}

export function listProjects(opts: { status?: string } = {}): Project[] {
  const status = opts.status ?? "active";
  return db
    .prepare(`SELECT * FROM projects WHERE status = ? ORDER BY updated_at DESC`)
    .all(status) as Project[];
}

export function getProject(id: string): Project | null {
  return (db.prepare(`SELECT * FROM projects WHERE id = ?`).get(id) as Project) ?? null;
}

export function createProject(input: {
  name: string;
  tagline?: string;
  purpose?: string;
  instructions?: string;
}): Project {
  const id = newId("proj");
  const ts = nowIso();
  db.prepare(
    `INSERT INTO projects (id, name, tagline, purpose, instructions, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`
  ).run(id, input.name, input.tagline ?? null, input.purpose ?? null, input.instructions ?? null, ts, ts);
  indexUpsert({
    kind: "project",
    refId: id,
    projectId: id,
    title: input.name,
    content: [input.tagline, input.purpose, input.instructions].filter(Boolean).join("\n"),
  });
  return getProject(id)!;
}

export function updateProject(
  id: string,
  patch: Partial<Pick<Project, "name" | "tagline" | "purpose" | "instructions" | "status">>
): Project | null {
  const existing = getProject(id);
  if (!existing) return null;
  const next = { ...existing, ...patch };
  db.prepare(
    `UPDATE projects SET name = ?, tagline = ?, purpose = ?, instructions = ?, status = ?, updated_at = ?
     WHERE id = ?`
  ).run(next.name, next.tagline, next.purpose, next.instructions, next.status, nowIso(), id);
  indexUpsert({
    kind: "project",
    refId: id,
    projectId: id,
    title: next.name,
    content: [next.tagline, next.purpose, next.instructions].filter(Boolean).join("\n"),
  });
  return getProject(id);
}

export function deleteProject(id: string) {
  db.prepare(`DELETE FROM projects WHERE id = ?`).run(id);
  indexRemove("project", id);
}

export function projectCounts(id: string) {
  const conversations = db
    .prepare(`SELECT COUNT(*) AS n FROM conversations WHERE project_id = ?`)
    .get(id) as { n: number };
  const memory = db.prepare(`SELECT COUNT(*) AS n FROM memory WHERE project_id = ?`).get(id) as {
    n: number;
  };
  const documents = db
    .prepare(`SELECT COUNT(*) AS n FROM documents WHERE project_id = ?`)
    .get(id) as { n: number };
  const artifacts = db
    .prepare(`SELECT COUNT(*) AS n FROM artifacts WHERE project_id = ?`)
    .get(id) as { n: number };
  const skills = db.prepare(`SELECT COUNT(*) AS n FROM skills WHERE project_id = ?`).get(id) as {
    n: number;
  };
  return {
    conversations: conversations.n,
    memory: memory.n,
    documents: documents.n,
    artifacts: artifacts.n,
    skills: skills.n,
  };
}
