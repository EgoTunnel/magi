import fs from "node:fs";
import path from "node:path";
import { db, newId, nowIso } from "@/lib/db";
import { indexRemove, indexUpsert } from "@/lib/searchIndex";
import { extractText, isExtractableFileType } from "@/lib/files/extractText";

export interface Doc {
  id: string;
  project_id: string;
  title: string;
  content: string;
  mime_type: string | null;
  file_path: string | null;
  created_at: string;
  updated_at: string;
}

const DOCUMENTS_DIR = path.join(process.cwd(), "data", "documents");
function ensureDir() {
  if (!fs.existsSync(DOCUMENTS_DIR)) fs.mkdirSync(DOCUMENTS_DIR, { recursive: true });
}

export function listDocuments(projectId: string): Doc[] {
  return db
    .prepare(`SELECT * FROM documents WHERE project_id = ? ORDER BY updated_at DESC`)
    .all(projectId) as Doc[];
}

export function getDocument(id: string): Doc | null {
  return (db.prepare(`SELECT * FROM documents WHERE id = ?`).get(id) as Doc) ?? null;
}

export function createDocument(projectId: string, title: string, content: string): Doc {
  const id = newId("doc");
  const ts = nowIso();
  db.prepare(
    `INSERT INTO documents (id, project_id, title, content, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, projectId, title, content, ts, ts);
  indexUpsert({ kind: "document", refId: id, projectId, title, content });
  return getDocument(id)!;
}

export function updateDocument(id: string, patch: { title?: string; content?: string }): Doc | null {
  const existing = getDocument(id);
  if (!existing) return null;
  const next = { ...existing, ...patch };
  db.prepare(`UPDATE documents SET title = ?, content = ?, updated_at = ? WHERE id = ?`).run(
    next.title,
    next.content,
    nowIso(),
    id
  );
  indexUpsert({ kind: "document", refId: id, projectId: next.project_id, title: next.title, content: next.content });
  return getDocument(id);
}

export function deleteDocument(id: string) {
  const existing = getDocument(id);
  db.prepare(`DELETE FROM documents WHERE id = ?`).run(id);
  indexRemove("document", id);
  if (existing?.file_path) {
    try {
      fs.unlinkSync(existing.file_path);
    } catch {
      // file already gone — fine
    }
  }
}

// Images are rejected here rather than silently accepted with no extracted
// text — Project Documents inject into contextBuilder.ts's single text-only
// system prompt, so an image would be useless to the model at that layer.
// Real vision support only exists for conversation attachments (see
// src/lib/repo/attachments.ts), where a live turn can carry actual image data.
export async function saveUploadedDocument(input: {
  projectId: string;
  filename: string;
  mimeType: string;
  buffer: Buffer;
}): Promise<Doc> {
  if (!isExtractableFileType(input.mimeType, input.filename)) {
    throw new Error(
      input.mimeType.startsWith("image/")
        ? "Images aren't supported as Project documents yet — attach them to a conversation instead, where Magi can see them directly."
        : `Unsupported file type for a Project document: ${input.mimeType || "unknown"}.`
    );
  }

  const content = await extractText({ buffer: input.buffer, mimeType: input.mimeType, filename: input.filename });

  ensureDir();
  const id = newId("doc");
  const ext = input.filename.slice(input.filename.lastIndexOf(".")) || "";
  const filePath = path.join(DOCUMENTS_DIR, `${id}${ext}`);
  fs.writeFileSync(filePath, input.buffer);

  const ts = nowIso();
  db.prepare(
    `INSERT INTO documents (id, project_id, title, content, mime_type, file_path, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, input.projectId, input.filename, content, input.mimeType, filePath, ts, ts);
  indexUpsert({ kind: "document", refId: id, projectId: input.projectId, title: input.filename, content });
  return getDocument(id)!;
}
