import fs from "node:fs";
import path from "node:path";
import { db, newId, nowIso } from "@/lib/db";

const IMAGES_DIR = path.join(process.cwd(), "data", "images");
function ensureDir() {
  if (!fs.existsSync(IMAGES_DIR)) fs.mkdirSync(IMAGES_DIR, { recursive: true });
}

export interface GeneratedImage {
  id: string;
  project_id: string;
  prompt: string;
  model: string;
  style_guide_id: string | null;
  character_ids: string[];
  source_image_id: string | null;
  file_path: string;
  mime_type: string;
  created_at: string;
  source: "generated" | "uploaded";
}

interface GeneratedImageRow {
  id: string;
  project_id: string;
  prompt: string;
  model: string;
  style_guide_id: string | null;
  character_ids: string;
  source_image_id: string | null;
  file_path: string;
  mime_type: string;
  created_at: string;
  source: "generated" | "uploaded";
}

function parse(row: GeneratedImageRow): GeneratedImage {
  return { ...row, character_ids: JSON.parse(row.character_ids) as string[] };
}

const EXT_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/gif": "gif",
};

const UPLOADABLE_IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

// Decodes a `data:image/...;base64,...` URI, writes the bytes to disk under
// data/images/, and records the metadata. Images live on disk rather than in
// SQLite so the database stays small and the files stay directly inspectable —
// consistent with the local-first, "your files, not a blob" posture elsewhere.
export function saveGeneratedImage(input: {
  projectId: string;
  prompt: string;
  model: string;
  dataUrl: string;
  styleGuideId?: string | null;
  characterIds?: string[];
  sourceImageId?: string | null;
}): GeneratedImage {
  ensureDir();
  const match = input.dataUrl.match(/^data:([^;]+);base64,([\s\S]+)$/);
  if (!match) throw new Error("Expected a base64 data URI for the generated image.");
  const mimeType = match[1];
  const bytes = Buffer.from(match[2], "base64");
  const ext = EXT_BY_MIME[mimeType] ?? "png";

  const id = newId("img");
  const filePath = path.join(IMAGES_DIR, `${id}.${ext}`);
  fs.writeFileSync(filePath, bytes);

  const ts = nowIso();
  db.prepare(
    `INSERT INTO images (id, project_id, prompt, model, style_guide_id, character_ids, source_image_id, file_path, mime_type, created_at, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'generated')`
  ).run(
    id,
    input.projectId,
    input.prompt,
    input.model,
    input.styleGuideId ?? null,
    JSON.stringify(input.characterIds ?? []),
    input.sourceImageId ?? null,
    filePath,
    mimeType,
    ts
  );
  return getImage(id)!;
}

export function isUploadableImageMime(mimeType: string): boolean {
  return UPLOADABLE_IMAGE_MIMES.has(mimeType);
}

// A real photo (or other image file) brought in directly, rather than
// produced by a model — same table and file storage as a generation, just
// with no prompt/model behind it. Lets a Character's reference image be an
// actual picture of the person/thing instead of only an AI rendering.
export function saveUploadedImage(input: {
  projectId: string;
  filename: string;
  mimeType: string;
  buffer: Buffer;
}): GeneratedImage {
  if (!isUploadableImageMime(input.mimeType)) {
    throw new Error(`Unsupported image type: ${input.mimeType || "unknown"}.`);
  }
  ensureDir();
  const id = newId("img");
  const ext = EXT_BY_MIME[input.mimeType] ?? "png";
  const filePath = path.join(IMAGES_DIR, `${id}.${ext}`);
  fs.writeFileSync(filePath, input.buffer);

  const ts = nowIso();
  db.prepare(
    `INSERT INTO images (id, project_id, prompt, model, style_guide_id, character_ids, source_image_id, file_path, mime_type, created_at, source)
     VALUES (?, ?, ?, ?, NULL, '[]', NULL, ?, ?, ?, 'uploaded')`
  ).run(id, input.projectId, input.filename, "upload", filePath, input.mimeType, ts);
  return getImage(id)!;
}

export function listImages(projectId: string): GeneratedImage[] {
  const rows = db
    .prepare(`SELECT * FROM images WHERE project_id = ? ORDER BY created_at DESC`)
    .all(projectId) as GeneratedImageRow[];
  return rows.map(parse);
}

export function getImage(id: string): GeneratedImage | null {
  const row = db.prepare(`SELECT * FROM images WHERE id = ?`).get(id) as GeneratedImageRow | undefined;
  return row ? parse(row) : null;
}

export function deleteImage(id: string) {
  const image = getImage(id);
  if (!image) return;
  db.prepare(`DELETE FROM images WHERE id = ?`).run(id);
  try {
    fs.unlinkSync(image.file_path);
  } catch {
    // file already gone — fine
  }
}
