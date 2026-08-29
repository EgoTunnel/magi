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
}

function parse(row: GeneratedImageRow): GeneratedImage {
  return { ...row, character_ids: JSON.parse(row.character_ids) as string[] };
}

const EXT_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/svg+xml": "svg",
};

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
    `INSERT INTO images (id, project_id, prompt, model, style_guide_id, character_ids, source_image_id, file_path, mime_type, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
