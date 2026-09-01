import { db, newId, nowIso } from "@/lib/db";
import { indexRemove, indexUpsert } from "@/lib/searchIndex";

export interface Character {
  id: string;
  project_id: string;
  name: string;
  description: string;
  reference_image_id: string | null;
  created_at: string;
}

export function listCharacters(projectId: string): Character[] {
  return db
    .prepare(`SELECT * FROM characters WHERE project_id = ? ORDER BY created_at DESC`)
    .all(projectId) as Character[];
}

export function getCharacter(id: string): Character | null {
  return (db.prepare(`SELECT * FROM characters WHERE id = ?`).get(id) as Character) ?? null;
}

export function createCharacter(projectId: string, name: string, description: string): Character {
  const id = newId("char");
  const ts = nowIso();
  db.prepare(
    `INSERT INTO characters (id, project_id, name, description, reference_image_id, created_at)
     VALUES (?, ?, ?, ?, NULL, ?)`
  ).run(id, projectId, name, description, ts);
  indexUpsert({ kind: "character", refId: id, projectId, title: name, content: description });
  return getCharacter(id)!;
}

export function setCharacterReferenceImage(id: string, imageId: string) {
  db.prepare(`UPDATE characters SET reference_image_id = ? WHERE id = ?`).run(imageId, id);
}

export function updateCharacter(id: string, patch: { name?: string; description?: string }): Character | null {
  const existing = getCharacter(id);
  if (!existing) return null;
  const next = { ...existing, ...patch };
  db.prepare(`UPDATE characters SET name = ?, description = ? WHERE id = ?`).run(next.name, next.description, id);
  indexUpsert({ kind: "character", refId: id, projectId: next.project_id, title: next.name, content: next.description });
  return getCharacter(id);
}

export function deleteCharacter(id: string) {
  db.prepare(`DELETE FROM characters WHERE id = ?`).run(id);
  indexRemove("character", id);
}
