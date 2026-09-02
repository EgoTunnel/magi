// Float32 vector storage and comparison, shared by the whole-item embedding
// index (src/lib/searchIndex.ts) and the passage index (src/lib/retrieval.ts).
// SQLite has no vector type; a packed Float32Array BLOB is compact, exact, and
// needs no extension.

export function packVector(vector: number[]): Buffer {
  return Buffer.from(new Float32Array(vector).buffer);
}

export function unpackVector(buf: Buffer): Float32Array {
  return new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4);
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
