import { db, nowIso } from "@/lib/db";
import { getSetting, setSetting, getEmbeddingModelId, getOpenRouterApiKey } from "@/lib/settings";
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

// Singleton, fire-and-forget job — same pattern as Agents/Connections
// (src/lib/agent.ts, src/lib/connections.ts), just tracked as one settings
// row instead of a table since there's no run history to keep, only "is it
// running and how far did it get."
export async function runEmbeddingBackfill() {
  const modelId = getEmbeddingModelId();
  if (!modelId || !getOpenRouterApiKey()) {
    setBackfillStatus({ status: "error", processed: 0, total: 0, model: modelId, error: "NO_EMBEDDING_MODEL", updatedAt: nowIso() });
    return;
  }
  if (getBackfillStatus().status === "running") return;

  // Passage rows first, and locally — they need no API key, and everything
  // below embeds them. This is normally already done (the context builder
  // calls it on the first turn after upgrading), in which case it's a no-op.
  ensureChunkIndex();

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
