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
  brand_philosophy: string | null;
  brand_heading_font: string | null;
  brand_body_font: string | null;
  brand_primary_color: string | null;
  brand_accent_color: string | null;
  brand_text_color: string | null;
  brand_subtitle_color: string | null;
  brand_label_color: string | null;
  brand_secondary_accent_color: string | null;
  parent_project_id: string | null;
  pinned: number;
}

export function listProjects(opts: { status?: string } = {}): Project[] {
  const status = opts.status ?? "active";
  return db
    .prepare(`SELECT * FROM projects WHERE status = ? ORDER BY pinned DESC, updated_at DESC`)
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
  parentProjectId?: string | null;
}): Project {
  const id = newId("proj");
  const ts = nowIso();
  db.prepare(
    `INSERT INTO projects (id, name, tagline, purpose, instructions, status, created_at, updated_at, parent_project_id)
     VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)`
  ).run(
    id,
    input.name,
    input.tagline ?? null,
    input.purpose ?? null,
    input.instructions ?? null,
    ts,
    ts,
    input.parentProjectId ?? null
  );
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
  patch: Partial<
    Pick<
      Project,
      | "name"
      | "tagline"
      | "purpose"
      | "instructions"
      | "status"
      | "brand_philosophy"
      | "brand_heading_font"
      | "brand_body_font"
      | "brand_primary_color"
      | "brand_accent_color"
      | "brand_text_color"
      | "brand_subtitle_color"
      | "brand_label_color"
      | "brand_secondary_accent_color"
      | "parent_project_id"
      | "pinned"
    >
  >
): Project | null {
  const existing = getProject(id);
  if (!existing) return null;
  if (
    patch.parent_project_id !== undefined &&
    patch.parent_project_id !== null &&
    patch.parent_project_id !== existing.parent_project_id
  ) {
    if (patch.parent_project_id === id) {
      throw new Error("A Project can't be its own parent.");
    }
    if (wouldCreateCycle(id, patch.parent_project_id)) {
      throw new Error("That would create a loop — the chosen parent is already a descendant of this Project.");
    }
  }
  const next = { ...existing, ...patch };
  db.prepare(
    `UPDATE projects SET name = ?, tagline = ?, purpose = ?, instructions = ?, status = ?, updated_at = ?,
       brand_philosophy = ?, brand_heading_font = ?, brand_body_font = ?,
       brand_primary_color = ?, brand_accent_color = ?, brand_text_color = ?,
       brand_subtitle_color = ?, brand_label_color = ?, brand_secondary_accent_color = ?,
       parent_project_id = ?, pinned = ?
     WHERE id = ?`
  ).run(
    next.name,
    next.tagline,
    next.purpose,
    next.instructions,
    next.status,
    nowIso(),
    next.brand_philosophy,
    next.brand_heading_font,
    next.brand_body_font,
    next.brand_primary_color,
    next.brand_accent_color,
    next.brand_text_color,
    next.brand_subtitle_color,
    next.brand_label_color,
    next.brand_secondary_accent_color,
    next.parent_project_id,
    next.pinned,
    id
  );
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

// A hard ceiling on chain length purely as a guard against ever walking an
// unbounded loop if the data is somehow corrupted — wouldCreateCycle() is
// what's meant to make that actually impossible in normal use.
const MAX_HIERARCHY_DEPTH = 12;

export function listChildProjects(parentId: string): Project[] {
  return db
    .prepare(`SELECT * FROM projects WHERE parent_project_id = ? AND status = 'active' ORDER BY name ASC`)
    .all(parentId) as Project[];
}

// Root-first: the top-level ancestor comes first, the immediate parent last.
// Excludes the Project itself.
export function listAncestorProjects(id: string): Project[] {
  const chain: Project[] = [];
  let current = getProject(id);
  for (let i = 0; i < MAX_HIERARCHY_DEPTH && current?.parent_project_id; i++) {
    const parent = getProject(current.parent_project_id);
    if (!parent) break;
    chain.unshift(parent);
    current = parent;
  }
  return chain;
}

// Every descendant id at any depth, excluding the Project itself.
export function listDescendantProjectIds(id: string): string[] {
  const ids: string[] = [];
  let frontier = [id];
  for (let depth = 0; depth < MAX_HIERARCHY_DEPTH && frontier.length; depth++) {
    const children = frontier.flatMap((pid) => listChildProjects(pid));
    if (!children.length) break;
    ids.push(...children.map((c) => c.id));
    frontier = children.map((c) => c.id);
  }
  return ids;
}

// self + every ancestor + every descendant — the "family" a search from this
// Project should reach, without pulling in unrelated siblings' own subtrees.
export function familyProjectIds(id: string): string[] {
  return [id, ...listAncestorProjects(id).map((p) => p.id), ...listDescendantProjectIds(id)];
}

// True if setting projectId's parent to proposedParentId would create a
// loop — i.e. proposedParentId is projectId itself or already one of its
// own descendants.
export function wouldCreateCycle(projectId: string, proposedParentId: string): boolean {
  if (proposedParentId === projectId) return true;
  return listDescendantProjectIds(projectId).includes(proposedParentId);
}
