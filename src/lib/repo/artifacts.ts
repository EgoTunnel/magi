import fs from "node:fs";
import path from "node:path";
import { db, newId, nowIso } from "@/lib/db";
import { indexUpsert } from "@/lib/searchIndex";
import { markdownToDocxBuffer } from "@/lib/files/markdownToDocx";

export interface Artifact {
  id: string;
  project_id: string;
  conversation_id: string | null;
  message_id: string | null;
  title: string;
  type: string;
  content: string;
  mime_type: string | null;
  file_path: string | null;
  version: number;
  parent_id: string | null;
  created_at: string;
}

const ARTIFACTS_DIR = path.join(process.cwd(), "data", "artifacts");
function ensureDir() {
  if (!fs.existsSync(ARTIFACTS_DIR)) fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
}

export function listArtifacts(projectId: string): Artifact[] {
  // Latest version of each lineage, newest first.
  const rows = db
    .prepare(`SELECT * FROM artifacts WHERE project_id = ? ORDER BY created_at DESC`)
    .all(projectId) as Artifact[];
  const latestByLineage = new Map<string, Artifact>();
  for (const row of rows) {
    const lineage = lineageRoot(rows, row);
    const current = latestByLineage.get(lineage);
    if (!current || row.version > current.version) latestByLineage.set(lineage, row);
  }
  return Array.from(latestByLineage.values()).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

// Every artifact created in a conversation, not collapsed to the latest
// version per lineage like listArtifacts() — each turn that produced a file
// (v1, or a later revision) is a distinct point in the conversation's own
// history and should show up where it actually happened, keyed by
// message_id below.
export function listArtifactsByConversation(conversationId: string): Artifact[] {
  return db
    .prepare(`SELECT * FROM artifacts WHERE conversation_id = ? ORDER BY created_at ASC`)
    .all(conversationId) as Artifact[];
}

// Tool calls that produce an artifact (create_docx) run mid-stream, before
// the assistant message they belong to has been persisted — so, same as
// attachments, the artifact is created first and linked to its message
// afterward once addMessage() returns a real id. See chat/route.ts.
export function attachArtifactsToMessage(artifactIds: string[], messageId: string) {
  const stmt = db.prepare(`UPDATE artifacts SET message_id = ? WHERE id = ?`);
  for (const id of artifactIds) stmt.run(messageId, id);
}

function lineageRoot(all: Artifact[], row: Artifact): string {
  let cur = row;
  while (cur.parent_id) {
    const parent = all.find((a) => a.id === cur.parent_id);
    if (!parent) break;
    cur = parent;
  }
  return cur.id;
}

export function getArtifact(id: string): Artifact | null {
  return (db.prepare(`SELECT * FROM artifacts WHERE id = ?`).get(id) as Artifact) ?? null;
}

export function listVersions(id: string): Artifact[] {
  const root = getArtifact(id);
  if (!root) return [];
  const all = db.prepare(`SELECT * FROM artifacts WHERE project_id = ?`).all(root.project_id) as Artifact[];
  const rootId = lineageRoot(all, root);
  return all
    .filter((a) => lineageRoot(all, a) === rootId)
    .sort((a, b) => a.version - b.version);
}

export function createArtifact(input: {
  projectId: string;
  conversationId?: string;
  title: string;
  type?: string;
  content: string;
  filePath?: string;
  mimeType?: string;
}): Artifact {
  const id = newId("art");
  const ts = nowIso();
  db.prepare(
    `INSERT INTO artifacts (id, project_id, conversation_id, title, type, content, mime_type, file_path, version, parent_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, NULL, ?)`
  ).run(
    id,
    input.projectId,
    input.conversationId ?? null,
    input.title,
    input.type ?? "document",
    input.content,
    input.mimeType ?? null,
    input.filePath ?? null,
    ts
  );
  indexUpsert({ kind: "artifact", refId: id, projectId: input.projectId, title: input.title, content: input.content });
  return getArtifact(id)!;
}

export function createNewVersion(
  parentId: string,
  content: string,
  title?: string,
  file?: { filePath: string; mimeType: string }
): Artifact | null {
  const parent = getArtifact(parentId);
  if (!parent) return null;
  const id = newId("art");
  const ts = nowIso();
  db.prepare(
    `INSERT INTO artifacts (id, project_id, conversation_id, title, type, content, mime_type, file_path, version, parent_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    parent.project_id,
    parent.conversation_id,
    title ?? parent.title,
    parent.type,
    content,
    file?.mimeType ?? null,
    file?.filePath ?? null,
    parent.version + 1,
    parentId,
    ts
  );
  indexUpsert({
    kind: "artifact",
    refId: id,
    projectId: parent.project_id,
    title: title ?? parent.title,
    content,
  });
  return getArtifact(id);
}

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

// The one place that turns Markdown into a real, downloadable Word document —
// see src/lib/files/markdownToDocx.ts for the actual conversion. `content`
// stores the Markdown source (not text extracted back out of the .docx), so
// the artifact stays FTS-searchable exactly like a plain-text artifact.
export async function saveDocxArtifact(input: {
  projectId: string;
  conversationId?: string;
  title: string;
  markdown: string;
  parentId?: string;
}): Promise<Artifact> {
  const buffer = await markdownToDocxBuffer(input.markdown, input.title);
  ensureDir();
  // Just for a unique filename — the actual artifact row's id is assigned
  // inside createArtifact()/createNewVersion() below, independently.
  const fileId = newId("art");
  const filePath = path.join(ARTIFACTS_DIR, `${fileId}.docx`);
  fs.writeFileSync(filePath, buffer);

  if (input.parentId) {
    const version = createNewVersion(input.parentId, input.markdown, input.title, { filePath, mimeType: DOCX_MIME });
    if (!version) throw new Error(`Artifact ${input.parentId} not found — can't create a new version.`);
    return version;
  }
  return createArtifact({
    projectId: input.projectId,
    conversationId: input.conversationId,
    title: input.title,
    type: "docx",
    content: input.markdown,
    filePath,
    mimeType: DOCX_MIME,
  });
}
