// Server-side text extraction for uploaded Project Documents and conversation
// attachments. Deliberately extracts to plain text rather than sending PDFs/DOCX
// natively to a provider — this works identically across Anthropic and every
// OpenRouter model, with no per-model capability detection, and slots directly
// into Magi's existing text-only context (system prompt injection, FTS5/embedding
// search) alongside pasted Documents.
// Must be imported before "pdf-parse" itself — without it, pdfjs-dist (which
// pdf-parse wraps) can't find its worker script under Next.js's bundler and
// throws "Setting up fake worker failed" at request time.
import "pdf-parse/worker";
import { PDFParse } from "pdf-parse";
import mammoth from "mammoth";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PLAIN_TEXT_MIMES = new Set(["text/plain", "text/markdown", "text/csv", "application/json"]);
const PLAIN_TEXT_EXTENSIONS = new Set([".txt", ".md", ".csv", ".json"]);

export function isExtractableFileType(mimeType: string, filename: string): boolean {
  if (mimeType === "application/pdf" || mimeType === DOCX_MIME) return true;
  if (PLAIN_TEXT_MIMES.has(mimeType)) return true;
  const ext = filename.slice(filename.lastIndexOf(".")).toLowerCase();
  return PLAIN_TEXT_EXTENSIONS.has(ext) || ext === ".docx" || ext === ".pdf";
}

export async function extractText(input: { buffer: Buffer; mimeType: string; filename: string }): Promise<string> {
  const { buffer, mimeType, filename } = input;
  const ext = filename.slice(filename.lastIndexOf(".")).toLowerCase();

  if (mimeType === "application/pdf" || ext === ".pdf") {
    const parser = new PDFParse({ data: buffer });
    try {
      // No page-boundary markers — this text is read as one continuous document,
      // not paginated, same as everything else Magi injects into context.
      const result = await parser.getText({ pageJoiner: "" });
      return result.text;
    } finally {
      await parser.destroy();
    }
  }

  if (mimeType === DOCX_MIME || ext === ".docx") {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }

  if (PLAIN_TEXT_MIMES.has(mimeType) || PLAIN_TEXT_EXTENSIONS.has(ext)) {
    return buffer.toString("utf-8");
  }

  throw new Error(`Unsupported file type: ${mimeType || ext || "unknown"}`);
}
