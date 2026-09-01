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
import { unzipSync } from "fflate";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const PLAIN_TEXT_MIMES = new Set(["text/plain", "text/markdown", "text/csv", "application/json"]);
const PLAIN_TEXT_EXTENSIONS = new Set([".txt", ".md", ".csv", ".json"]);

export function isExtractableFileType(mimeType: string, filename: string): boolean {
  if (mimeType === "application/pdf" || mimeType === DOCX_MIME || mimeType === PPTX_MIME) return true;
  if (PLAIN_TEXT_MIMES.has(mimeType)) return true;
  const ext = filename.slice(filename.lastIndexOf(".")).toLowerCase();
  return PLAIN_TEXT_EXTENSIONS.has(ext) || ext === ".docx" || ext === ".pdf" || ext === ".pptx";
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)))
    .replace(/&amp;/g, "&");
}

// One line of on-slide text per <a:p> paragraph — joining every <a:t> run
// within it, since a run boundary is just a formatting change (a bold word
// mid-sentence, say), not a line break. Empty paragraphs (spacer lines,
// bullets with no text yet) are dropped.
function paragraphTextsFrom(xml: string): string[] {
  const paragraphs = xml.match(/<a:p>[\s\S]*?<\/a:p>/g) ?? [];
  return paragraphs
    .map((p) => Array.from(p.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)).map((m) => decodeXmlEntities(m[1])).join(""))
    .filter((line) => line.trim().length > 0);
}

// ppt/slides/slideN.xml is numbered by creation order, not display order —
// once slides get reordered in PowerPoint the two drift apart. The real
// order lives in presentation.xml's <p:sldIdLst>, resolved through each
// r:id's target in presentation.xml.rels. Falls back to a natural sort of
// the slide filenames themselves if either file is missing or unparsable.
function orderedSlidePaths(files: Record<string, Uint8Array>, decoder: TextDecoder): string[] {
  const presXml = files["ppt/presentation.xml"];
  const relsXml = files["ppt/_rels/presentation.xml.rels"];
  if (presXml && relsXml) {
    const relMap = new Map<string, string>();
    for (const tag of decoder.decode(relsXml).match(/<Relationship\b[^>]*\/>/g) ?? []) {
      const id = tag.match(/\bId="([^"]+)"/)?.[1];
      const target = tag.match(/\bTarget="([^"]+)"/)?.[1];
      if (id && target) relMap.set(id, target);
    }
    const rIds = Array.from(decoder.decode(presXml).matchAll(/<p:sldId\b[^>]*r:id="([^"]+)"/g)).map((m) => m[1]);
    const ordered = rIds
      .map((id) => relMap.get(id))
      .filter((t): t is string => !!t)
      .map((t) => `ppt/${t.replace(/^\.?\//, "")}`)
      .filter((p) => files[p]);
    if (ordered.length) return ordered;
  }
  return Object.keys(files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/(\d+)/)![1]) - Number(b.match(/(\d+)/)![1]));
}

function extractPptxText(buffer: Buffer): string {
  const files = unzipSync(new Uint8Array(buffer));
  const decoder = new TextDecoder();
  const slidePaths = orderedSlidePaths(files, decoder);
  return slidePaths
    .map((path, i) => {
      const lines = paragraphTextsFrom(decoder.decode(files[path]));
      return `## Slide ${i + 1}\n${lines.join("\n")}`;
    })
    .join("\n\n");
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

  if (mimeType === PPTX_MIME || ext === ".pptx") {
    return extractPptxText(buffer);
  }

  if (PLAIN_TEXT_MIMES.has(mimeType) || PLAIN_TEXT_EXTENSIONS.has(ext)) {
    return buffer.toString("utf-8");
  }

  throw new Error(`Unsupported file type: ${mimeType || ext || "unknown"}`);
}
