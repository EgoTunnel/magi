import { db, newId, nowIso } from "@/lib/db";
import { indexRemove, indexUpsert } from "@/lib/searchIndex";

export interface StyleGuide {
  id: string;
  project_id: string;
  name: string;
  description: string;
  created_at: string;
}

export function listStyleGuides(projectId: string): StyleGuide[] {
  return db
    .prepare(`SELECT * FROM style_guides WHERE project_id = ? ORDER BY created_at DESC`)
    .all(projectId) as StyleGuide[];
}

export function getStyleGuide(id: string): StyleGuide | null {
  return (db.prepare(`SELECT * FROM style_guides WHERE id = ?`).get(id) as StyleGuide) ?? null;
}

export function createStyleGuide(projectId: string, name: string, description: string): StyleGuide {
  const id = newId("style");
  const ts = nowIso();
  db.prepare(
    `INSERT INTO style_guides (id, project_id, name, description, created_at) VALUES (?, ?, ?, ?, ?)`
  ).run(id, projectId, name, description, ts);
  indexUpsert({ kind: "style_guide", refId: id, projectId, title: name, content: description });
  return getStyleGuide(id)!;
}

export function deleteStyleGuide(id: string) {
  db.prepare(`DELETE FROM style_guides WHERE id = ?`).run(id);
  indexRemove("style_guide", id);
}
