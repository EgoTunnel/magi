import { db, nowIso } from "@/lib/db";
import { chunkText } from "@/lib/chunking";
import { embedTexts, isEmbeddingConfigured } from "@/lib/models/embeddings";
import { getEmbeddingModelId, getSetting, setSetting } from "@/lib/settings";
import { packVector, unpackVector, cosineSimilarity } from "@/lib/vectors";
// Type-only: searchIndex.ts imports this module's functions at runtime, so a
// value import here would be a real cycle. Types are erased, this is not.
import type { SearchKind } from "@/lib/searchIndex";

// How many passages go into one embedding request. Chunks are ~1200
// characters, so a batch of 16 is roughly 5k tokens — comfortably inside every
// embedding model's input ceiling, and 16x fewer round trips than one apiece.
const EMBED_BATCH = 16;
// Deliberately generous: a passage is only useful if enough of it is in the
// prompt to read, and 20 passages of ~1200 characters is still a fraction of
// any modern context window.
const DEFAULT_RETRIEVAL_LIMIT = 20;
// One document must not be able to fill the whole retrieval budget just
// because it is long. Past three passages the marginal value of another
// paragraph of the same source is far below the first passage of a different
// one — which is the entire point of retrieving across a Project's material.
const MAX_PER_SOURCE = 3;
// Reciprocal-rank-fusion constant. 60 is the value from the original RRF
// paper and the usual default; it flattens the head of each list enough that
// a strong result in one ranking isn't outvoted by a mediocre one in both.
const RRF_K = 60;

export interface RetrievedChunk {
  chunkId: string;
  kind: SearchKind;
  refId: string;
  projectId: string | null;
  title: string;
  chunkIndex: number;
  content: string;
  sourceDate: string;
  // Present when this passage was found by embedding similarity; absent when
  // it came from keyword matching alone, where there's no comparable number.
  similarity?: number;
  matchedBy: "meaning" | "keyword" | "both";
}

function chunkId(kind: SearchKind, refId: string, index: number) {
  return `${kind}:${refId}:${index}`;
}

const deleteChunkRows = db.prepare(`DELETE FROM chunks WHERE kind = ? AND ref_id = ?`);
const deleteChunkSearchRows = db.prepare(
  `DELETE FROM chunk_search WHERE chunk_id IN (SELECT id FROM chunks WHERE kind = ? AND ref_id = ?)`
);
const insertChunk = db.prepare(
  `INSERT INTO chunks (id, kind, ref_id, project_id, title, chunk_index, content, source_date, model, vector, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)`
);
const insertChunkSearch = db.prepare(`INSERT INTO chunk_search (chunk_id, content) VALUES (?, ?)`);

export function removeChunks(kind: SearchKind, refId: string) {
  // FTS5 rows are deleted first — the subquery that finds them reads the
  // chunks table, which the next statement empties.
  deleteChunkSearchRows.run(kind, refId);
  deleteChunkRows.run(kind, refId);
}

// Moves an item's passages to a different Project alongside the item itself
// (see moveConversation in src/lib/repo/conversations.ts). Project scoping is
// what keeps retrieval from leaking one Project's material into another's
// turns, so this has to travel with every other project_id update.
export function retargetChunks(kind: SearchKind, refIds: string[], projectId: string) {
  if (!refIds.length) return;
  const placeholders = refIds.map(() => "?").join(",");
  db.prepare(`UPDATE chunks SET project_id = ? WHERE kind = ? AND ref_id IN (${placeholders})`).run(
    projectId,
    kind,
    ...refIds
  );
}

// Rebuilds the passage rows for one item. Called from indexUpsert() so every
// write path in Magi maintains the passage index without having to know it
// exists. The rows themselves are written synchronously (they're the keyword
// half of retrieval and must be queryable immediately); vectors are filled in
// afterwards by queueChunkEmbeddings, which never blocks and never throws.
export function reindexChunks(opts: {
  kind: SearchKind;
  refId: string;
  projectId: string | null;
  title: string;
  content: string;
  sourceDate?: string;
  skipEmbedding?: boolean;
}) {
  const chunks = chunkText(opts.content);
  const ts = nowIso();
  const sourceDate = opts.sourceDate ?? ts;

  const write = db.transaction(() => {
    removeChunks(opts.kind, opts.refId);
    for (const chunk of chunks) {
      const id = chunkId(opts.kind, opts.refId, chunk.index);
      insertChunk.run(
        id,
        opts.kind,
        opts.refId,
        opts.projectId,
        opts.title,
        chunk.index,
        chunk.content,
        sourceDate,
        ts
      );
      insertChunkSearch.run(id, chunk.content);
    }
  });
  write();

  if (!opts.skipEmbedding && chunks.length) queueChunkEmbeddings(opts.kind, opts.refId);
}

// Same fire-and-forget posture as queueEmbedding() in searchIndex.ts: a
// missing key, an unset embedding model, or a flaky request degrades
// retrieval to its keyword half rather than breaking the save that triggered
// it. Whatever this misses is closed by the Settings "Build index" backfill.
function queueChunkEmbeddings(kind: SearchKind, refId: string) {
  const modelId = getEmbeddingModelId();
  if (!modelId || !isEmbeddingConfigured()) return;
  const rows = db
    .prepare(`SELECT id, title, content FROM chunks WHERE kind = ? AND ref_id = ? ORDER BY chunk_index`)
    .all(kind, refId) as Array<{ id: string; title: string; content: string }>;
  embedChunkRows(rows, modelId).catch((err) => {
    console.error(`[retrieval] chunk embedding failed for ${kind}:${refId}`, err instanceof Error ? err.message : err);
  });
}

const setChunkVector = db.prepare(`UPDATE chunks SET model = ?, vector = ? WHERE id = ?`);

// Embeds a set of passages in batches and stores the vectors. Shared by the
// per-write path above and the Settings backfill, so both agree on batch size,
// on prefixing the title (a bare paragraph often doesn't say what it's about),
// and on what a partial failure leaves behind.
export async function embedChunkRows(
  rows: Array<{ id: string; title: string; content: string }>,
  modelId: string,
  onProgress?: (done: number) => void
) {
  let done = 0;
  for (let i = 0; i < rows.length; i += EMBED_BATCH) {
    const batch = rows.slice(i, i + EMBED_BATCH);
    const vectors = await embedTexts(
      modelId,
      batch.map((r) => `${r.title}\n\n${r.content}`)
    );
    const store = db.transaction(() => {
      batch.forEach((row, j) => setChunkVector.run(modelId, packVector(vectors[j]), row.id));
    });
    store();
    done += batch.length;
    onProgress?.(done);
  }
}

const CHUNK_BACKFILL_KEY = "chunk_index_built";
const DATE_REPAIR_KEY = "chunk_dates_repaired";

// Where each kind's authoritative date actually lives. search_index.created_at
// is only the moment a row was *indexed*, which for everything that existed
// before the passage index shipped is the same afternoon — and a trajectory
// built on that says every idea in the archive was had on one day. The real
// dates were in the source tables the whole time.
const DATE_SOURCES: Array<{ kind: SearchKind; table: string }> = [
  { kind: "message", table: "messages" },
  { kind: "conversation", table: "conversations" },
  { kind: "document", table: "documents" },
  { kind: "artifact", table: "artifacts" },
  { kind: "memory", table: "memory" },
  { kind: "skill", table: "skills" },
  { kind: "project", table: "projects" },
  { kind: "style_guide", table: "style_guides" },
  { kind: "character", table: "characters" },
  { kind: "person", table: "people" },
];

// One-time repair, same posture as ensureChunkIndex: local, no network, guarded
// by a settings flag, and safe to leave un-flagged on failure so the next turn
// retries. Only touches rows whose source row still exists.
export function repairChunkDates() {
  if (getSetting(DATE_REPAIR_KEY) === "1") return;
  try {
    for (const { kind, table } of DATE_SOURCES) {
      db.prepare(
        `UPDATE chunks
         SET source_date = (SELECT created_at FROM ${table} WHERE id = chunks.ref_id)
         WHERE kind = ? AND EXISTS (SELECT 1 FROM ${table} WHERE id = chunks.ref_id)`
      ).run(kind);
      // Passages whose source row is gone entirely. The app's own delete path
      // (indexRemove → removeChunks) prevents these, so they only exist where
      // something wrote to the database directly — but one orphan is enough to
      // wrongly appear as a topic's most recent mention forever, so the same
      // pass that fixes dates clears them out.
      db.prepare(
        `DELETE FROM chunk_search WHERE chunk_id IN (
           SELECT id FROM chunks
           WHERE kind = ? AND NOT EXISTS (SELECT 1 FROM ${table} WHERE id = chunks.ref_id)
         )`
      ).run(kind);
      db.prepare(
        `DELETE FROM chunks
         WHERE kind = ? AND NOT EXISTS (SELECT 1 FROM ${table} WHERE id = chunks.ref_id)`
      ).run(kind);
    }
    setSetting(DATE_REPAIR_KEY, "1");
  } catch (err) {
    console.error("[retrieval] chunk date repair failed", err instanceof Error ? err.message : err);
  }
}

// Passages are built on write, which covers everything saved from here on but
// nothing already in the database when this shipped. Chunking is pure local
// work — no network, no API key — so rather than making retrieval depend on
// the user knowing to press "Build index" in Settings, the first turn after
// upgrading builds the missing passages itself. One pass, then a settings flag
// makes it a no-op forever. Vectors are a separate, optional step (they need a
// key) and are left to the backfill; keyword retrieval works without them.
export function ensureChunkIndex() {
  if (getSetting(CHUNK_BACKFILL_KEY) === "1") {
    repairChunkDates();
    return;
  }
  try {
    const covered = new Set(
      (db.prepare(`SELECT DISTINCT kind, ref_id FROM chunks`).all() as Array<{ kind: string; ref_id: string }>).map(
        (r) => `${r.kind}:${r.ref_id}`
      )
    );
    const rows = db
      .prepare(`SELECT kind, ref_id, project_id, title, content, created_at FROM search_index`)
      .all() as Array<{
      kind: SearchKind;
      ref_id: string;
      project_id: string | null;
      title: string;
      content: string;
      created_at: string;
    }>;
    for (const row of rows) {
      if (!row.content.trim() || covered.has(`${row.kind}:${row.ref_id}`)) continue;
      reindexChunks({
        kind: row.kind,
        refId: row.ref_id,
        projectId: row.project_id,
        title: row.title,
        content: row.content,
        sourceDate: row.created_at,
        skipEmbedding: true,
      });
    }
    setSetting(CHUNK_BACKFILL_KEY, "1");
    repairChunkDates();
  } catch (err) {
    // Leaving the flag unset means the next turn tries again. Retrieval falls
    // back to whatever passages did get built, and the context builder falls
    // back to whole documents if that's nothing — never a failed turn.
    console.error("[retrieval] chunk backfill failed", err instanceof Error ? err.message : err);
  }
}

export function countChunks(): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM chunks`).get() as { n: number }).n;
}

export function listUnembeddedChunks(modelId: string): Array<{ id: string; title: string; content: string }> {
  return db
    .prepare(`SELECT id, title, content FROM chunks WHERE model IS NOT ? OR vector IS NULL`)
    .all(modelId) as Array<{ id: string; title: string; content: string }>;
}

// ORing every word of a natural-language query pulls in whatever the common
// words match, which is nearly everything. bm25 ranks that noise away, so
// ordinary retrieval survives it — but a *count* of matches doesn't, and
// "AI in the classroom" reported 14,574 matching passages on the strength of
// the word "the". Removing these costs nothing: a query made only of them has
// no content to retrieve on anyway.
const STOPWORDS = new Set([
  "the", "and", "for", "are", "but", "not", "you", "all", "any", "can", "had", "has", "have", "her",
  "his", "its", "our", "out", "was", "were", "what", "when", "where", "which", "who", "whom", "why",
  "how", "with", "from", "into", "onto", "than", "that", "them", "then", "they", "this", "these",
  "those", "there", "their", "been", "being", "does", "did", "done", "each", "some", "such", "only",
  "own", "same", "too", "very", "will", "would", "could", "should", "about", "after", "before",
  "between", "during", "over", "under", "again", "more", "most", "other", "your", "yours", "just",
  "also", "get", "got", "make", "made", "one", "two", "way", "use", "used", "using",
]);

// FTS5 ANDs bare terms together, which is right for an explicit search box and
// wrong for retrieval against a whole sentence the user typed — one unusual
// word would zero out the result set. The lexical half of hybrid retrieval
// therefore ORs its terms and lets bm25 do the ranking.
function ftsOrQuery(query: string): string | null {
  const words = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 2);
  // A query that is nothing but common words keeps them — matching broadly is
  // still better than matching nothing.
  const meaningful = words.filter((t) => !STOPWORDS.has(t));
  const terms = (meaningful.length ? meaningful : words).slice(0, 24);
  if (!terms.length) return null;
  return terms.map((t) => `"${t.replace(/"/g, '""')}"*`).join(" OR ");
}

function excludeClause(refIds: string[] | undefined, column: string): { sql: string; params: string[] } {
  if (!refIds?.length) return { sql: "", params: [] };
  return { sql: ` AND ${column} NOT IN (${refIds.map(() => "?").join(",")})`, params: refIds };
}

function projectClause(projectId: string | string[] | undefined, column: string): { sql: string; params: string[] } {
  if (Array.isArray(projectId)) {
    if (!projectId.length) return { sql: "", params: [] };
    return { sql: ` AND ${column} IN (${projectId.map(() => "?").join(",")})`, params: projectId };
  }
  if (projectId) return { sql: ` AND ${column} = ?`, params: [projectId] };
  return { sql: "", params: [] };
}

interface ChunkRow {
  id: string;
  kind: SearchKind;
  ref_id: string;
  project_id: string | null;
  title: string;
  chunk_index: number;
  content: string;
  source_date: string;
}

// Everything about a passage except the passage. The semantic half reads this
// shape rather than ChunkRow: ranking never looks at the text, and reading it
// for every stored passage on every turn was most of what that scan cost.
type ChunkMeta = Omit<ChunkRow, "content">;

// Fills in the text for passages that were selected without it.
function chunkContents(ids: string[]): Map<string, string> {
  if (!ids.length) return new Map();
  const rows = db
    .prepare(`SELECT id, content FROM chunks WHERE id IN (${ids.map(() => "?").join(",")})`)
    .all(...ids) as Array<{ id: string; content: string }>;
  return new Map(rows.map((r) => [r.id, r.content]));
}

function keywordChunks(query: string, opts: RetrieveOptions, limit: number): ChunkRow[] {
  const match = ftsOrQuery(query);
  if (!match) return [];
  const project = projectClause(opts.projectId, "c.project_id");
  const kinds = opts.kinds?.length ? ` AND c.kind IN (${opts.kinds.map(() => "?").join(",")})` : "";
  const exclude = excludeClause(opts.excludeRefIds, "c.ref_id");
  return db
    .prepare(
      `SELECT c.id, c.kind, c.ref_id, c.project_id, c.title, c.chunk_index, c.content, c.source_date
       FROM chunk_search
       JOIN chunks c ON c.id = chunk_search.chunk_id
       WHERE chunk_search MATCH ?${project.sql}${kinds}${exclude.sql}
       ORDER BY bm25(chunk_search)
       LIMIT ?`
    )
    .all(match, ...project.params, ...(opts.kinds ?? []), ...exclude.params, limit) as ChunkRow[];
}

// Uncapped counts of keyword-matching passages, grouped by date. Retrieval
// pools are capped by relevance, so counting *them* describes the pool rather
// than the archive — a topic that came up 400 times and one that came up 40
// would both report the cap. This is the honest denominator: every passage
// whose text actually matches, with its real date, no ranking involved.
export function matchCountsByDate(
  query: string,
  opts: RetrieveOptions = {}
): { total: number; earliest: string | null; latest: string | null; byMonth: Map<string, number> } {
  const match = ftsOrQuery(query);
  const empty = { total: 0, earliest: null, latest: null, byMonth: new Map<string, number>() };
  if (!match) return empty;

  const project = projectClause(opts.projectId, "c.project_id");
  const kinds = opts.kinds?.length ? ` AND c.kind IN (${opts.kinds.map(() => "?").join(",")})` : "";
  const rows = db
    .prepare(
      `SELECT substr(c.source_date, 1, 7) AS month, COUNT(*) AS n,
              MIN(c.source_date) AS earliest, MAX(c.source_date) AS latest
       FROM chunk_search
       JOIN chunks c ON c.id = chunk_search.chunk_id
       WHERE chunk_search MATCH ?${project.sql}${kinds}
       GROUP BY month
       ORDER BY month ASC`
    )
    .all(match, ...project.params, ...(opts.kinds ?? [])) as Array<{
    month: string;
    n: number;
    earliest: string;
    latest: string;
  }>;
  if (!rows.length) return empty;

  return {
    total: rows.reduce((sum, r) => sum + r.n, 0),
    earliest: rows[0].earliest,
    latest: rows[rows.length - 1].latest,
    byMonth: new Map(rows.map((r) => [r.month, r.n])),
  };
}

async function semanticChunks(
  query: string,
  opts: RetrieveOptions,
  limit: number
): Promise<Array<ChunkMeta & { similarity: number }>> {
  const modelId = getEmbeddingModelId();
  if (!modelId || !isEmbeddingConfigured()) return [];

  const project = projectClause(opts.projectId, "project_id");
  const kinds = opts.kinds?.length ? ` AND kind IN (${opts.kinds.map(() => "?").join(",")})` : "";
  const exclude = excludeClause(opts.excludeRefIds, "ref_id");

  const [queryVector] = await embedTexts(modelId, [query]);
  const q = new Float32Array(queryVector);

  // Iterated, not collected: a personal archive is already tens of thousands
  // of passages, and materializing every vector (a few KB apiece) to sort them
  // would mean a nine-figure allocation per turn on a cross-Project search.
  // Scoring as rows arrive keeps peak memory at `limit` candidates instead.
  //
  // `content` is deliberately absent from this select. Nothing here reads it —
  // ranking is the vector's job — and at ~1,200 characters per passage it was
  // the bulk of what this scan pulled off disk, for tens of thousands of rows,
  // to end up using twenty of them. The winners get their text in one query
  // afterwards (see chunkContents).
  const cursor = db
    .prepare(
      `SELECT id, kind, ref_id, project_id, title, chunk_index, source_date, vector
       FROM chunks
       WHERE model = ? AND vector IS NOT NULL${project.sql}${kinds}${exclude.sql}`
    )
    .iterate(modelId, ...project.params, ...(opts.kinds ?? []), ...exclude.params) as IterableIterator<
    ChunkMeta & { vector: Buffer }
  >;

  const best: Array<ChunkMeta & { similarity: number }> = [];
  for (const row of cursor) {
    const similarity = cosineSimilarity(q, unpackVector(row.vector));
    if (best.length === limit && similarity <= best[best.length - 1].similarity) continue;
    // Insertion sort into a list capped at `limit` — cheap, since after the
    // first few hundred rows almost everything fails the test above. The
    // vector itself is deliberately not carried forward; it has done its job.
    let at = best.length;
    while (at > 0 && best[at - 1].similarity < similarity) at--;
    best.splice(at, 0, {
      id: row.id,
      kind: row.kind,
      ref_id: row.ref_id,
      project_id: row.project_id,
      title: row.title,
      chunk_index: row.chunk_index,
      source_date: row.source_date,
      similarity,
    });
    if (best.length > limit) best.pop();
  }
  return best;
}

export interface RetrieveOptions {
  projectId?: string | string[];
  kinds?: SearchKind[];
  limit?: number;
  // Items whose passages must not be returned. The turn's own user message is
  // the case this exists for: it is indexed before the prompt is built, and it
  // is a perfect lexical match for the query, which is that query, so without
  // this it reliably retrieves itself as the top passage and spends the budget
  // telling the model what the user just said.
  excludeRefIds?: string[];
  // Overrides MAX_PER_SOURCE. Trajectory tracing raises it deliberately: when
  // the question is how a topic developed over time, a long conversation that
  // returned to it repeatedly *should* contribute more than three passages,
  // because that repetition is the answer.
  maxPerSource?: number;
}

// Hybrid passage retrieval: embedding similarity for "said the same thing in
// different words", keyword bm25 for names, identifiers, and exact phrasing,
// fused by reciprocal rank so neither has to be trusted alone. Either half
// alone still works — with no embedding model configured this degrades to
// passage-level keyword search rather than to nothing.
export async function retrieveChunks(query: string, opts: RetrieveOptions = {}): Promise<RetrievedChunk[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const limit = opts.limit ?? DEFAULT_RETRIEVAL_LIMIT;
  // Over-fetch from each half: the per-source cap and the fusion below both
  // discard candidates, and the shortfall has to come from somewhere.
  const pool = limit * 4;

  // The lexical half first, and synchronously: it is a single indexed query
  // against a snapshot of the passage table taken before the embedding round
  // trip below, which is what lets a caller start retrieval before the message
  // it excludes has been written (see prefetchRetrieval).
  const keyword = keywordChunks(trimmed, opts, pool);
  const semantic = await semanticChunks(trimmed, opts, pool).catch((err) => {
    console.error("[retrieval] semantic half failed", err instanceof Error ? err.message : err);
    return [] as Array<ChunkMeta & { similarity: number }>;
  });

  // The lexical half already read the text it matched on; the semantic half
  // deliberately didn't. Either way, only the passages that survive fusion and
  // the per-source cap need it.
  const contents = new Map<string, string>(keyword.map((r) => [r.id, r.content]));

  const scores = new Map<string, { row: ChunkMeta; score: number; similarity?: number; semantic: boolean; lexical: boolean }>();
  const add = (row: ChunkMeta, rank: number, half: "semantic" | "lexical", similarity?: number) => {
    const existing = scores.get(row.id);
    const contribution = 1 / (RRF_K + rank + 1);
    if (existing) {
      existing.score += contribution;
      if (similarity !== undefined) existing.similarity = similarity;
      if (half === "semantic") existing.semantic = true;
      else existing.lexical = true;
      return;
    }
    scores.set(row.id, {
      row,
      score: contribution,
      similarity,
      semantic: half === "semantic",
      lexical: half === "lexical",
    });
  };
  semantic.forEach((r, i) => add(r, i, "semantic", r.similarity));
  keyword.forEach((r, i) => add(r, i, "lexical"));

  const ranked = [...scores.values()].sort((a, b) => b.score - a.score);

  const perSourceCap = opts.maxPerSource ?? MAX_PER_SOURCE;
  const perSource = new Map<string, number>();
  const selected: typeof ranked = [];
  for (const entry of ranked) {
    if (selected.length >= limit) break;
    const sourceKey = `${entry.row.kind}:${entry.row.ref_id}`;
    const used = perSource.get(sourceKey) ?? 0;
    if (used >= perSourceCap) continue;
    perSource.set(sourceKey, used + 1);
    selected.push(entry);
  }

  const missing = selected.filter((e) => !contents.has(e.row.id)).map((e) => e.row.id);
  for (const [id, content] of chunkContents(missing)) contents.set(id, content);

  return selected.map((entry) => ({
    chunkId: entry.row.id,
    kind: entry.row.kind,
    refId: entry.row.ref_id,
    projectId: entry.row.project_id,
    title: entry.row.title,
    chunkIndex: entry.row.chunk_index,
    // A passage whose row vanished between the scan and here (a delete landing
    // mid-turn) has nothing to show; empty content costs the caller a wasted
    // slot rather than a broken turn.
    content: contents.get(entry.row.id) ?? "",
    sourceDate: entry.row.source_date,
    similarity: entry.similarity,
    matchedBy: entry.semantic && entry.lexical ? "both" : entry.semantic ? "meaning" : "keyword",
  }));
}
