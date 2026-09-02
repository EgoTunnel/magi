import { db, nowIso } from "@/lib/db";
import { getEmbeddingModelId, getOpenRouterApiKey } from "@/lib/settings";
import { embedText } from "@/lib/models/openrouter";
import { packVector, unpackVector, cosineSimilarity } from "@/lib/vectors";
import { reindexChunks, removeChunks } from "@/lib/retrieval";

// Kept well under typical embedding-model input ceilings (usually a few
// thousand tokens) without needing per-model token counting for this.
const EMBED_TEXT_BUDGET = 8000;
const SNIPPET_LENGTH = 240;

// Shared by the fire-and-forget per-write path below and the Settings
// "Build index" backfill (src/lib/embeddingBackfill.ts) — one place that
// knows how to turn (kind, refId, title, content) into a stored vector.
export async function storeEmbedding(opts: {
  kind: SearchKind;
  refId: string;
  projectId: string | null;
  title: string;
  content: string;
  modelId: string;
}) {
  const text = `${opts.title}\n\n${opts.content}`.slice(0, EMBED_TEXT_BUDGET);
  const vector = await embedText(opts.modelId, text);
  const snippet = opts.content.slice(0, SNIPPET_LENGTH);
  db.prepare(
    `INSERT INTO embeddings (kind, ref_id, project_id, model, title, snippet, vector, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(kind, ref_id) DO UPDATE SET
       project_id = excluded.project_id, model = excluded.model, title = excluded.title,
       snippet = excluded.snippet, vector = excluded.vector, updated_at = excluded.updated_at`
  ).run(opts.kind, opts.refId, opts.projectId, opts.modelId, opts.title, snippet, packVector(vector), nowIso());
}

// Fire-and-forget: called from indexUpsert() after every write, but never
// awaited there and never throws, so a missing key, unset model, or a flaky
// OpenRouter request never breaks the thing the user was actually doing.
// Coverage gaps this leaves behind are closed by the Settings "Build index"
// backfill, not by retrying here.
function queueEmbedding(opts: { kind: SearchKind; refId: string; projectId: string | null; title: string; content: string }) {
  const modelId = getEmbeddingModelId();
  if (!modelId || !getOpenRouterApiKey()) return;
  storeEmbedding({ ...opts, modelId }).catch((err) => {
    console.error(`[searchIndex] embedding failed for ${opts.kind}:${opts.refId}`, err instanceof Error ? err.message : err);
  });
}

// An array rather than a bare union, so callers that need "every kind except
// one" can derive it and automatically pick up any kind added later, instead of
// silently excluding it.
export const SEARCH_KINDS = [
  "project",
  "conversation",
  "message",
  "memory",
  "document",
  "artifact",
  "skill",
  "style_guide",
  "character",
  "person",
] as const;

export type SearchKind = (typeof SEARCH_KINDS)[number];

export function indexUpsert(opts: {
  kind: SearchKind;
  refId: string;
  projectId: string | null;
  title: string;
  content: string;
  // Set by bulk writers (Project import) to avoid firing one background
  // embedding request per row — a large foreign-chat import can be tens of
  // thousands of messages, which would otherwise hammer OpenRouter with an
  // unthrottled burst of concurrent requests. Use the Settings "Build index"
  // backfill (already batched and rate-limited) to index afterward instead.
  skipEmbedding?: boolean;
  // The date the underlying item is actually *from*, when the caller knows it
  // — an imported conversation from 2023 indexed today is 2023 material. Used
  // by passage retrieval so "when did I first think about this" can sort by
  // something truer than "when did this row get written."
  sourceDate?: string;
}) {
  db.prepare(`DELETE FROM search_index WHERE kind = ? AND ref_id = ?`).run(
    opts.kind,
    opts.refId
  );
  db.prepare(
    `INSERT INTO search_index (kind, ref_id, project_id, title, content, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(opts.kind, opts.refId, opts.projectId, opts.title, opts.content, opts.sourceDate ?? nowIso());
  // Every write path in Magi already funnels through here, which makes this
  // the one place that has to know the passage index exists — see
  // src/lib/retrieval.ts.
  reindexChunks(opts);
  if (!opts.skipEmbedding) queueEmbedding(opts);
}

export function indexRemove(kind: SearchKind, refId: string) {
  db.prepare(`DELETE FROM search_index WHERE kind = ? AND ref_id = ?`).run(kind, refId);
  db.prepare(`DELETE FROM embeddings WHERE kind = ? AND ref_id = ?`).run(kind, refId);
  removeChunks(kind, refId);
}

export interface SearchResult {
  kind: SearchKind;
  refId: string;
  projectId: string | null;
  title: string;
  snippet: string;
  createdAt: string;
  // Only set by semanticSearch() — a 0-1 cosine similarity score, absent
  // (not zero) on keyword results since there's nothing comparable to show.
  similarity?: number;
}

export function search(
  query: string,
  opts: { projectId?: string | string[]; kinds?: SearchKind[]; limit?: number } = {}
): SearchResult[] {
  const trimmed = query.trim();
  if (!trimmed) return [];
  // FTS5 query syntax dislikes bare punctuation; escape by quoting each term.
  const ftsQuery = trimmed
    .split(/\s+/)
    .map((t) => `"${t.replace(/"/g, '""')}"*`)
    .join(" ");

  const conditions: string[] = ["search_index MATCH ?"];
  const params: unknown[] = [ftsQuery];

  if (Array.isArray(opts.projectId)) {
    if (opts.projectId.length) {
      conditions.push(`project_id IN (${opts.projectId.map(() => "?").join(",")})`);
      params.push(...opts.projectId);
    }
  } else if (opts.projectId) {
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

// Embeds the query and ranks stored vectors by cosine similarity — brute
// force over whatever matches the currently-selected embedding model, which
// is the right amount of machinery at personal-archive scale (see
// docs/Handoff.md). Vectors from a previously-selected model are simply
// ignored, not deleted, so switching back to an earlier model works instantly.
export async function semanticSearch(
  query: string,
  opts: { projectId?: string | string[]; kinds?: SearchKind[]; limit?: number } = {}
): Promise<SearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const modelId = getEmbeddingModelId();
  if (!modelId || !getOpenRouterApiKey()) throw new Error("NO_EMBEDDING_MODEL");

  const queryVector = new Float32Array(await embedText(modelId, trimmed));

  const conditions: string[] = ["model = ?"];
  const params: unknown[] = [modelId];
  if (Array.isArray(opts.projectId)) {
    if (opts.projectId.length) {
      conditions.push(`project_id IN (${opts.projectId.map(() => "?").join(",")})`);
      params.push(...opts.projectId);
    }
  } else if (opts.projectId) {
    conditions.push("project_id = ?");
    params.push(opts.projectId);
  }
  if (opts.kinds && opts.kinds.length) {
    conditions.push(`kind IN (${opts.kinds.map(() => "?").join(",")})`);
    params.push(...opts.kinds);
  }

  const rows = db
    .prepare(
      `SELECT kind, ref_id, project_id, title, snippet, vector, updated_at
       FROM embeddings WHERE ${conditions.join(" AND ")}`
    )
    .all(...params) as Array<{
    kind: SearchKind;
    ref_id: string;
    project_id: string | null;
    title: string;
    snippet: string;
    vector: Buffer;
    updated_at: string;
  }>;

  const limit = opts.limit ?? 30;
  return rows
    .map((r) => ({
      kind: r.kind,
      refId: r.ref_id,
      projectId: r.project_id,
      title: r.title,
      snippet: r.snippet,
      createdAt: r.updated_at,
      similarity: cosineSimilarity(queryVector, unpackVector(r.vector)),
    }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}
