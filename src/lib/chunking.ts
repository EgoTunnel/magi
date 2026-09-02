// Splits a document, message, or artifact into passage-sized pieces so
// retrieval can return the part of a 200KB document that actually answers the
// question, rather than the first 12,000 characters of whichever document
// happened to be created first (which is what a whole-item index can do).
//
// Sizes are in characters, not tokens: everything else in Magi budgets in
// characters (DOCUMENT_BUDGET, ATTACHMENT_TEXT_BUDGET), and per-model token
// counting would buy precision nothing here actually needs.
const TARGET_CHARS = 1200;
// Below this, a trailing fragment is folded back into the previous chunk
// rather than stored as a chunk of its own — a 30-character orphan embeds
// badly and only ever adds noise to the ranking.
const MIN_CHARS = 200;
// Only applied when a single paragraph is longer than TARGET_CHARS and has to
// be cut mid-thought; paragraph boundaries are already natural seams and need
// no overlap to stay coherent.
const HARD_SPLIT_OVERLAP = 200;

export interface TextChunk {
  index: number;
  content: string;
}

// Cuts an over-long block at the last sentence end (or, failing that, the last
// whitespace) before the limit, so chunks rarely start or stop mid-word.
function splitPoint(text: string, limit: number): number {
  const window = text.slice(0, limit);
  const sentenceEnd = Math.max(
    window.lastIndexOf(". "),
    window.lastIndexOf("! "),
    window.lastIndexOf("? "),
    window.lastIndexOf(".\n")
  );
  if (sentenceEnd > limit * 0.5) return sentenceEnd + 1;
  const space = window.lastIndexOf(" ");
  if (space > limit * 0.5) return space;
  return limit;
}

function hardSplit(block: string): string[] {
  const parts: string[] = [];
  let rest = block;
  while (rest.length > TARGET_CHARS) {
    const cut = splitPoint(rest, TARGET_CHARS);
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(Math.max(0, cut - HARD_SPLIT_OVERLAP));
  }
  if (rest.trim()) parts.push(rest.trim());
  return parts;
}

export function chunkText(text: string): TextChunk[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.length <= TARGET_CHARS) return [{ index: 0, content: trimmed }];

  // Paragraphs first — a blank line is the strongest structural seam in the
  // Markdown that documents, messages, and artifacts are all written in.
  const blocks = trimmed.split(/\n\s*\n/).flatMap((b) => {
    const block = b.trim();
    if (!block) return [];
    return block.length > TARGET_CHARS ? hardSplit(block) : [block];
  });

  const chunks: string[] = [];
  let current = "";
  for (const block of blocks) {
    if (!current) {
      current = block;
    } else if (current.length + block.length + 2 <= TARGET_CHARS) {
      current = `${current}\n\n${block}`;
    } else {
      chunks.push(current);
      current = block;
    }
  }
  if (current) {
    if (current.length < MIN_CHARS && chunks.length) {
      chunks[chunks.length - 1] = `${chunks[chunks.length - 1]}\n\n${current}`;
    } else {
      chunks.push(current);
    }
  }

  return chunks.map((content, index) => ({ index, content }));
}
