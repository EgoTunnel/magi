// Runs once when the server starts. Used to get the passage-vector cache in
// memory before the first message needs it (see warmChunkVectorCache in
// src/lib/retrieval.ts) — deliberately not awaited, so it never holds up the
// server becoming ready.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { warmChunkVectorCache } = await import("@/lib/retrieval");
  setTimeout(() => {
    warmChunkVectorCache().catch((err) =>
      console.error("[instrumentation] vector cache warm-up failed", err instanceof Error ? err.message : err)
    );
  }, 0);
}
