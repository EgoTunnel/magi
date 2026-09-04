import fs from "node:fs";
import path from "node:path";
import { db, newId, nowIso } from "@/lib/db";
import { extractText, isExtractableFileType } from "@/lib/files/extractText";

export interface Attachment {
  id: string;
  conversation_id: string;
  message_id: string | null;
  filename: string;
  mime_type: string;
  file_path: string;
  kind: "image" | "text";
  extracted_text: string | null;
  created_at: string;
}

const ATTACHMENTS_DIR = path.join(process.cwd(), "data", "attachments");
function ensureDir() {
  if (!fs.existsSync(ATTACHMENTS_DIR)) fs.mkdirSync(ATTACHMENTS_DIR, { recursive: true });
}

const IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export function getAttachment(id: string): Attachment | null {
  return (db.prepare(`SELECT * FROM attachments WHERE id = ?`).get(id) as Attachment) ?? null;
}

export function listPendingAttachments(conversationId: string): Attachment[] {
  return db
    .prepare(`SELECT * FROM attachments WHERE conversation_id = ? AND message_id IS NULL ORDER BY created_at ASC`)
    .all(conversationId) as Attachment[];
}

// Extracts text immediately for text-kind files (so the pending chip can fail
// fast on an unreadable file) and stores images as-is — there's no text to
// extract, and real image content is only ever sent for the live turn it's
// attached to (see the chat route's history-rewriting step).
export async function createPendingAttachment(input: {
  conversationId: string;
  filename: string;
  mimeType: string;
  buffer: Buffer;
}): Promise<Attachment> {
  const isImage = IMAGE_MIMES.has(input.mimeType);
  if (!isImage && !isExtractableFileType(input.mimeType, input.filename)) {
    throw new Error(`Unsupported file type: ${input.mimeType || "unknown"}.`);
  }

  const extractedText = isImage
    ? null
    : await extractText({ buffer: input.buffer, mimeType: input.mimeType, filename: input.filename });

  ensureDir();
  const id = newId("att");
  const ext = input.filename.slice(input.filename.lastIndexOf(".")) || "";
  const filePath = path.join(ATTACHMENTS_DIR, `${id}${ext}`);
  fs.writeFileSync(filePath, input.buffer);

  const ts = nowIso();
  db.prepare(
    `INSERT INTO attachments (id, conversation_id, message_id, filename, mime_type, file_path, kind, extracted_text, created_at)
     VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?)`
  ).run(id, input.conversationId, input.filename, input.mimeType, filePath, isImage ? "image" : "text", extractedText, ts);
  return getAttachment(id)!;
}

export function attachToMessage(attachmentIds: string[], messageId: string) {
  const stmt = db.prepare(`UPDATE attachments SET message_id = ? WHERE id = ?`);
  for (const id of attachmentIds) stmt.run(messageId, id);
}

// Edit can't safely carry an attachment into a new branch (attachToMessage is
// one-row-one-owner — "copying" it would either duplicate the row or strip it
// from the original, now off-path, message) so the UI hides Edit on a message
// this returns true for rather than silently dropping the attachment.
export function hasAttachmentsForMessage(messageId: string): boolean {
  return !!db.prepare(`SELECT 1 FROM attachments WHERE message_id = ? LIMIT 1`).get(messageId);
}

// The same question for a whole conversation in one query. Asking it per
// message meant a round trip per turn every time the conversation was loaded —
// and it is reloaded at the end of every turn.
export function messagesWithAttachments(conversationId: string): Set<string> {
  const rows = db
    .prepare(`SELECT DISTINCT message_id FROM attachments WHERE conversation_id = ? AND message_id IS NOT NULL`)
    .all(conversationId) as Array<{ message_id: string }>;
  return new Set(rows.map((r) => r.message_id));
}

export function deleteAttachment(id: string) {
  const existing = getAttachment(id);
  if (!existing) return;
  db.prepare(`DELETE FROM attachments WHERE id = ?`).run(id);
  try {
    fs.unlinkSync(existing.file_path);
  } catch {
    // file already gone — fine
  }
}
