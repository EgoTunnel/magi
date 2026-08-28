import { db, nowIso } from "@/lib/db";

export type SearchKind =
  | "project"
  | "conversation"
  | "message"
  | "memory"
  | "document"
  | "artifact"
  | "skill";

export function indexUpsert(opts: {
  kind: SearchKind;
  refId: string;
  projectId: string | null;
  title: string;
  content: string;
}) {
  db.prepare(`DELETE FROM search_index WHERE kind = ? AND ref_id = ?`).run(
    opts.kind,
    opts.refId
  );
  db.prepare(
    `INSERT INTO search_index (kind, ref_id, project_id, title, content, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(opts.kind, opts.refId, opts.projectId, opts.title, opts.content, nowIso());
}

export function indexRemove(kind: SearchKind, refId: string) {
  db.prepare(`DELETE FROM search_index WHERE kind = ? AND ref_id = ?`).run(kind, refId);
}

export interface SearchResult {
  kind: SearchKind;
  refId: string;
  projectId: string | null;
  title: string;
  snippet: string;
  createdAt: string;
}

export function search(query: string, opts: { projectId?: string; kinds?: SearchKind[]; limit?: number } = {}): SearchResult[] {
  const trimmed = query.trim();
  if (!trimmed) return [];
  // FTS5 query syntax dislikes bare punctuation; escape by quoting each term.
  const ftsQuery = trimmed
    .split(/\s+/)
    .map((t) => `"${t.replace(/"/g, '""')}"*`)
    .join(" ");

  const conditions: string[] = ["search_index MATCH ?"];
  const params: unknown[] = [ftsQuery];

  if (opts.projectId) {
    conditions.push("project_id = ?");
    params.push(opts.projectId);
  }
  if (opts.kinds && opts.kinds.length) {
    conditions.push(`kind IN (${opts.kinds.map(() => "?").join(",")})`);
    params.push(...opts.kinds);
  }

  const limit = opts.limit ?? 30;
  const rows = db
    .prepare(
      `SELECT kind, ref_id, project_id, title,
              snippet(search_index, 4, '⟦', '⟧', '…', 24) AS snippet,
              created_at
       FROM search_index
       WHERE ${conditions.join(" AND ")}
       ORDER BY rank
       LIMIT ?`
    )
    .all(...params, limit) as Array<{
    kind: SearchKind;
    ref_id: string;
    project_id: string | null;
    title: string;
    snippet: string;
    created_at: string;
  }>;

  return rows.map((r) => ({
    kind: r.kind,
    refId: r.ref_id,
    projectId: r.project_id,
    title: r.title,
    snippet: r.snippet,
    createdAt: r.created_at,
  }));
}
