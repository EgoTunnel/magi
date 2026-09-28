import { db, nowIso } from "@/lib/db";
import { getSetting, setSetting, getEmbeddingModelId } from "@/lib/settings";
import { isEmbeddingConfigured } from "@/lib/models/embeddings";
import { storeEmbedding, type SearchKind } from "@/lib/searchIndex";
import { embedChunkRows, ensureChunkIndex, listUnembeddedChunks } from "@/lib/retrieval";

const STATUS_KEY = "embedding_backfill_status";
const BATCH_SIZE = 5;

export interface BackfillStatus {
  status: "idle" | "running" | "complete" | "error";
  processed: number;
  total: number;
  model: string | null;
  error?: string;
  updatedAt: string;
}

export function getBackfillStatus(): BackfillStatus {
  const raw = getSetting(STATUS_KEY);
  if (!raw) return { status: "idle", processed: 0, total: 0, model: null, updatedAt: nowIso() };
  try {
    return JSON.parse(raw) as BackfillStatus;
  } catch {
    return { status: "idle", processed: 0, total: 0, model: null, updatedAt: nowIso() };
  }
}

function setBackfillStatus(status: BackfillStatus) {
  setSetting(STATUS_KEY, JSON.stringify(status));
}

// Vectors whose search_index row is gone. indexRemove() deletes all three
// tables together, so nothing on the ordinary delete path leaves these behind
// — but anything that removed a row another way (a direct SQL cleanup, an
// older build) did, and semanticSearch reads the embeddings table directly.
// That makes an orphan a correctness problem and not just wasted bytes:
// deleted content can still come back as a Meaning-search hit. Reconciling
// here rather than in a migration means it self-heals however it happened.
export function pruneOrphanedEmbeddings(): number {
  // search_index is an FTS5 virtual table, so it has no b-tree on
  // (kind, ref_id) — a correlated `NOT EXISTS` against it costs a full scan of
  // the FTS content per candidate row, which on a real archive means tens of
  // thousands of chunks times thousands of indexed items. Measured at over
  // three minutes before this was rewritten. Materialising the live keys once
  // into an indexed temp table turns the whole thing into one scan plus
  // primary-key lookups.
  return db.transaction(() => {
    db.prepare(`DROP TABLE IF EXISTS temp.live_keys`).run();
    db.prepare(`CREATE TEMP TABLE live_keys (kind TEXT NOT NULL, ref_id TEXT NOT NULL, PRIMARY KEY (kind, ref_id))`).run();
    db.prepare(`INSERT OR IGNORE INTO temp.live_keys (kind, ref_id) SELECT kind, ref_id FROM search_index`).run();

    const embeddings = db
      .prepare(
        `DELETE FROM embeddings WHERE NOT EXISTS (
           SELECT 1 FROM temp.live_keys k WHERE k.kind = embeddings.kind AND k.ref_id = embeddings.ref_id
         )`
      )
      .run();
    // FTS5 rows first, and found through the chunks table the next statement
    // empties — the ordering removeChunks() depends on (src/lib/retrieval.ts).
    db.prepare(
      `DELETE FROM chunk_search WHERE chunk_id IN (
         SELECT c.id FROM chunks c
         WHERE NOT EXISTS (SELECT 1 FROM temp.live_keys k WHERE k.kind = c.kind AND k.ref_id = c.ref_id)
       )`
    ).run();
    const chunks = db
      .prepare(
        `DELETE FROM chunks WHERE NOT EXISTS (
           SELECT 1 FROM temp.live_keys k WHERE k.kind = chunks.kind AND k.ref_id = chunks.ref_id
         )`
      )
      .run();

    db.prepare(`DROP TABLE temp.live_keys`).run();
    return embeddings.changes + chunks.changes;
  })();
}

// Singleton, fire-and-forget job — same pattern as Agents/Connections
// (src/lib/agent.ts, src/lib/connections.ts), just tracked as one settings
// row instead of a table since there's no run history to keep, only "is it
// running and how far did it get."
export async function runEmbeddingBackfill() {
  const modelId = getEmbeddingModelId();
  if (!modelId || !isEmbeddingConfigured()) {
    setBackfillStatus({ status: "error", processed: 0, total: 0, model: modelId, error: "NO_EMBEDDING_MODEL", updatedAt: nowIso() });
    return;
  }
  if (getBackfillStatus().status === "running") return;

  // Passage rows first, and locally — they need no API key, and everything
  // below embeds them. This is normally already done (the context builder
  // calls it on the first turn after upgrading), in which case it's a no-op.
  ensureChunkIndex();
  pruneOrphanedEmbeddings();

  // search_index is already a complete, denormalized mirror of every
  // indexable entity's kind/ref_id/project_id/title/content — reusing it
  // here avoids re-querying nine separate repo tables.
  const rows = db
    .prepare(`SELECT kind, ref_id, project_id, title, content FROM search_index`)
    .all() as Array<{ kind: SearchKind; ref_id: string; project_id: string | null; title: string; content: string }>;

  const already = new Set(
    (db.prepare(`SELECT kind, ref_id FROM embeddings WHERE model = ?`).all(modelId) as Array<{ kind: string; ref_id: string }>).map(
      (r) => `${r.kind}:${r.ref_id}`
    )
  );
  const pending = rows.filter((r) => !already.has(`${r.kind}:${r.ref_id}`));

  // Passages are the second half of the job — the one retrieval-first context
  // assembly actually reads (src/lib/retrieval.ts). Both halves are counted
  // into one total so the Settings progress bar means "how much of the index
  // is built", not "how far through the first of two invisible phases."
  const pendingChunks = listUnembeddedChunks(modelId);
  const total = pending.length + pendingChunks.length;

  setBackfillStatus({ status: "running", processed: 0, total, model: modelId, updatedAt: nowIso() });

  let processed = 0;
  try {
    for (let i = 0; i < pending.length; i += BATCH_SIZE) {
      const batch = pending.slice(i, i + BATCH_SIZE);
      await Promise.all(
        batch.map((row) =>
          storeEmbedding({
            kind: row.kind,
            refId: row.ref_id,
            projectId: row.project_id,
            title: row.title,
            content: row.content,
            modelId,
          })
        )
      );
      processed += batch.length;
      setBackfillStatus({ status: "running", processed, total, model: modelId, updatedAt: nowIso() });
    }

    const itemsDone = processed;
    await embedChunkRows(pendingChunks, modelId, (done) => {
      processed = itemsDone + done;
      setBackfillStatus({ status: "running", processed, total, model: modelId, updatedAt: nowIso() });
    });
    processed = total;

    setBackfillStatus({ status: "complete", processed, total, model: modelId, updatedAt: nowIso() });
  } catch (err) {
    setBackfillStatus({
      status: "error",
      processed,
      total,
      model: modelId,
      error: err instanceof Error ? err.message : "Backfill failed",
      updatedAt: nowIso(),
    });
  }
}
