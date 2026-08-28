import { db, newId, nowIso } from "@/lib/db";
import { indexRemove, indexUpsert } from "@/lib/searchIndex";

export interface Doc {
  id: string;
  project_id: string;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
}

export function listDocuments(projectId: string): Doc[] {
  return db
    .prepare(`SELECT * FROM documents WHERE project_id = ? ORDER BY updated_at DESC`)
    .all(projectId) as Doc[];
}

export function getDocument(id: string): Doc | null {
  return (db.prepare(`SELECT * FROM documents WHERE id = ?`).get(id) as Doc) ?? null;
}

export function createDocument(projectId: string, title: string, content: string): Doc {
  const id = newId("doc");
  const ts = nowIso();
  db.prepare(
    `INSERT INTO documents (id, project_id, title, content, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, projectId, title, content, ts, ts);
  indexUpsert({ kind: "document", refId: id, projectId, title, content });
  return getDocument(id)!;
}

export function updateDocument(id: string, patch: { title?: string; content?: string }): Doc | null {
  const existing = getDocument(id);
  if (!existing) return null;
  const next = { ...existing, ...patch };
  db.prepare(`UPDATE documents SET title = ?, content = ?, updated_at = ? WHERE id = ?`).run(
    next.title,
    next.content,
    nowIso(),
    id
  );
  indexUpsert({ kind: "document", refId: id, projectId: next.project_id, title: next.title, content: next.content });
  return getDocument(id);
}

export function deleteDocument(id: string) {
  db.prepare(`DELETE FROM documents WHERE id = ?`).run(id);
  indexRemove("document", id);
}
