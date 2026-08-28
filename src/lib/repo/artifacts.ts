import { db, newId, nowIso } from "@/lib/db";
import { indexUpsert } from "@/lib/searchIndex";

export interface Artifact {
  id: string;
  project_id: string;
  conversation_id: string | null;
  title: string;
  type: string;
  content: string;
  version: number;
  parent_id: string | null;
  created_at: string;
}

export function listArtifacts(projectId: string): Artifact[] {
  // Latest version of each lineage, newest first.
  const rows = db
    .prepare(`SELECT * FROM artifacts WHERE project_id = ? ORDER BY created_at DESC`)
    .all(projectId) as Artifact[];
  const latestByLineage = new Map<string, Artifact>();
  for (const row of rows) {
    const lineage = lineageRoot(rows, row);
    const current = latestByLineage.get(lineage);
    if (!current || row.version > current.version) latestByLineage.set(lineage, row);
  }
  return Array.from(latestByLineage.values()).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

function lineageRoot(all: Artifact[], row: Artifact): string {
  let cur = row;
  while (cur.parent_id) {
    const parent = all.find((a) => a.id === cur.parent_id);
    if (!parent) break;
    cur = parent;
  }
  return cur.id;
}

export function getArtifact(id: string): Artifact | null {
  return (db.prepare(`SELECT * FROM artifacts WHERE id = ?`).get(id) as Artifact) ?? null;
}

export function listVersions(id: string): Artifact[] {
  const root = getArtifact(id);
  if (!root) return [];
  const all = db.prepare(`SELECT * FROM artifacts WHERE project_id = ?`).all(root.project_id) as Artifact[];
  const rootId = lineageRoot(all, root);
  return all
    .filter((a) => lineageRoot(all, a) === rootId)
    .sort((a, b) => a.version - b.version);
}

export function createArtifact(input: {
  projectId: string;
  conversationId?: string;
  title: string;
  type?: string;
  content: string;
}): Artifact {
  const id = newId("art");
  const ts = nowIso();
  db.prepare(
    `INSERT INTO artifacts (id, project_id, conversation_id, title, type, content, version, parent_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, NULL, ?)`
  ).run(id, input.projectId, input.conversationId ?? null, input.title, input.type ?? "document", input.content, ts);
  indexUpsert({ kind: "artifact", refId: id, projectId: input.projectId, title: input.title, content: input.content });
  return getArtifact(id)!;
}

export function createNewVersion(parentId: string, content: string, title?: string): Artifact | null {
  const parent = getArtifact(parentId);
  if (!parent) return null;
  const id = newId("art");
  const ts = nowIso();
  db.prepare(
    `INSERT INTO artifacts (id, project_id, conversation_id, title, type, content, version, parent_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    parent.project_id,
    parent.conversation_id,
    title ?? parent.title,
    parent.type,
    content,
    parent.version + 1,
    parentId,
    ts
  );
  indexUpsert({
    kind: "artifact",
    refId: id,
    projectId: parent.project_id,
    title: title ?? parent.title,
    content,
  });
  return getArtifact(id);
}
