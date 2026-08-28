import { db, newId, nowIso } from "@/lib/db";
import { indexRemove, indexUpsert } from "@/lib/searchIndex";

export interface MemoryItem {
  id: string;
  scope: "global" | "project";
  project_id: string | null;
  content: string;
  source: string | null;
  status: "established" | "suggested";
  created_at: string;
}

export function listMemory(opts: { scope?: "global" | "project"; projectId?: string } = {}): MemoryItem[] {
  if (opts.scope === "global") {
    return db
      .prepare(`SELECT * FROM memory WHERE scope = 'global' ORDER BY created_at DESC`)
      .all() as MemoryItem[];
  }
  if (opts.projectId) {
    return db
      .prepare(
        `SELECT * FROM memory WHERE (scope = 'project' AND project_id = ?) OR scope = 'global'
         ORDER BY created_at DESC`
      )
      .all(opts.projectId) as MemoryItem[];
  }
  return db.prepare(`SELECT * FROM memory ORDER BY created_at DESC`).all() as MemoryItem[];
}

export function createMemory(input: {
  scope: "global" | "project";
  projectId?: string;
  content: string;
  source?: string;
  status?: "established" | "suggested";
}): MemoryItem {
  const id = newId("mem");
  const ts = nowIso();
  db.prepare(
    `INSERT INTO memory (id, scope, project_id, content, source, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.scope,
    input.scope === "project" ? input.projectId ?? null : null,
    input.content,
    input.source ?? "manual",
    input.status ?? "established",
    ts
  );
  indexUpsert({
    kind: "memory",
    refId: id,
    projectId: input.scope === "project" ? input.projectId ?? null : null,
    title: `${input.scope} memory`,
    content: input.content,
  });
  return db.prepare(`SELECT * FROM memory WHERE id = ?`).get(id) as MemoryItem;
}

export function updateMemory(id: string, content: string): MemoryItem | null {
  db.prepare(`UPDATE memory SET content = ? WHERE id = ?`).run(content, id);
  const row = db.prepare(`SELECT * FROM memory WHERE id = ?`).get(id) as MemoryItem | undefined;
  if (row) {
    indexUpsert({
      kind: "memory",
      refId: id,
      projectId: row.project_id,
      title: `${row.scope} memory`,
      content: row.content,
    });
  }
  return row ?? null;
}

export function deleteMemory(id: string) {
  db.prepare(`DELETE FROM memory WHERE id = ?`).run(id);
  indexRemove("memory", id);
}
