import { db, newId, nowIso } from "@/lib/db";
import { indexRemove, indexUpsert, type SearchKind } from "@/lib/searchIndex";
import { retargetChunks } from "@/lib/retrieval";

export interface Conversation {
  id: string;
  project_id: string;
  title: string;
  status: "active" | "archived";
  created_at: string;
  updated_at: string;
  // The leaf of the currently-viewed branch — see addMessage()/getActivePath().
  head_message_id: string | null;
}

export interface Message {
  id: string;
  conversation_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  model: string | null;
  provenance: string | null;
  created_at: string;
  // The message this one continues from. NULL for the first message in a
  // conversation. Editing a user message or regenerating a reply creates a
  // new sibling (same parent_id) rather than mutating an existing row, so a
  // conversation is a tree, not a line — see getActivePath().
  parent_id: string | null;
}

export function listConversations(projectId: string): Conversation[] {
  return db
    .prepare(`SELECT * FROM conversations WHERE project_id = ? ORDER BY updated_at DESC`)
    .all(projectId) as Conversation[];
}

// Cross-project "what have I been doing lately" list for the sidebar — active
// conversations in active Projects only, newest first.
export function listRecentConversations(limit: number): (Conversation & { project_name: string })[] {
  return db
    .prepare(
      `SELECT c.*, p.name AS project_name
       FROM conversations c
       JOIN projects p ON p.id = c.project_id
       WHERE c.status = 'active' AND p.status = 'active'
       ORDER BY c.updated_at DESC
       LIMIT ?`
    )
    .all(limit) as (Conversation & { project_name: string })[];
}

export function getConversation(id: string): Conversation | null {
  return (db.prepare(`SELECT * FROM conversations WHERE id = ?`).get(id) as Conversation) ?? null;
}

export function createConversation(projectId: string, title?: string): Conversation {
  const id = newId("conv");
  const ts = nowIso();
  db.prepare(
    `INSERT INTO conversations (id, project_id, title, status, created_at, updated_at)
     VALUES (?, ?, ?, 'active', ?, ?)`
  ).run(id, projectId, title ?? "Untitled conversation", ts, ts);
  indexUpsert({
    kind: "conversation",
    refId: id,
    projectId,
    title: title ?? "Untitled conversation",
    content: "",
  });
  return getConversation(id)!;
}

export function renameConversation(id: string, title: string) {
  db.prepare(`UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?`).run(
    title,
    nowIso(),
    id
  );
  const convo = getConversation(id);
  if (convo) {
    indexUpsert({ kind: "conversation", refId: id, projectId: convo.project_id, title, content: "" });
  }
}

export function archiveConversation(id: string, archived = true) {
  db.prepare(`UPDATE conversations SET status = ?, updated_at = ? WHERE id = ?`).run(
    archived ? "archived" : "active",
    nowIso(),
    id
  );
}

// Reassigns a conversation (and everything that travels with it — its
// artifacts, and the search/embedding rows for the conversation itself, its
// messages, and its artifacts) to a different Project. Message rows and
// attachments don't carry their own project_id (they're scoped only via
// conversation_id), so those need no update at all.
export function moveConversation(id: string, newProjectId: string): Conversation | null {
  const existing = getConversation(id);
  if (!existing) return null;

  const messageIds = (db.prepare(`SELECT id FROM messages WHERE conversation_id = ?`).all(id) as { id: string }[]).map(
    (m) => m.id
  );
  const artifactIds = (
    db.prepare(`SELECT id FROM artifacts WHERE conversation_id = ?`).all(id) as { id: string }[]
  ).map((a) => a.id);

  db.prepare(`UPDATE conversations SET project_id = ?, updated_at = ? WHERE id = ?`).run(newProjectId, nowIso(), id);
  if (artifactIds.length) {
    db.prepare(`UPDATE artifacts SET project_id = ? WHERE conversation_id = ?`).run(newProjectId, id);
  }

  const retarget = (kind: SearchKind, refIds: string[]) => {
    if (!refIds.length) return;
    const placeholders = refIds.map(() => "?").join(",");
    db.prepare(`UPDATE search_index SET project_id = ? WHERE kind = ? AND ref_id IN (${placeholders})`).run(
      newProjectId,
      kind,
      ...refIds
    );
    db.prepare(`UPDATE embeddings SET project_id = ? WHERE kind = ? AND ref_id IN (${placeholders})`).run(
      newProjectId,
      kind,
      ...refIds
    );
    retargetChunks(kind, refIds, newProjectId);
  };
  retarget("conversation", [id]);
  retarget("message", messageIds);
  retarget("artifact", artifactIds);

  return getConversation(id);
}

export function deleteConversation(id: string) {
  // The message ids have to be collected *before* the conversation row goes:
  // messages cascade on that delete, so querying for them afterwards returns
  // nothing and every message's search, embedding, and passage rows are
  // orphaned — leaving a deleted conversation permanently searchable.
  const messageIds = (db.prepare(`SELECT id FROM messages WHERE conversation_id = ?`).all(id) as {
    id: string;
  }[]).map((m) => m.id);
  const artifactIds = (
    db.prepare(`SELECT id FROM artifacts WHERE conversation_id = ?`).all(id) as { id: string }[]
  ).map((a) => a.id);

  db.prepare(`DELETE FROM conversations WHERE id = ?`).run(id);
  indexRemove("conversation", id);
  for (const messageId of messageIds) indexRemove("message", messageId);
  // Artifacts don't cascade (conversation_id has no FK), so they survive the
  // delete and keep their index rows — but any that did go need clearing too.
  for (const artifactId of artifactIds) {
    if (!db.prepare(`SELECT 1 FROM artifacts WHERE id = ?`).get(artifactId)) indexRemove("artifact", artifactId);
  }
}

export function listMessages(conversationId: string): Message[] {
  // rowid (SQLite maintains one even for a TEXT primary key) tiebreaks
  // same-millisecond inserts deterministically — created_at alone doesn't,
  // since nowIso() has no monotonic counter, and sibling/leaf ordering
  // (conversationBranches.ts) depends on this being stable.
  return db
    .prepare(`SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC, rowid ASC`)
    .all(conversationId) as Message[];
}

// Repoints which leaf is currently being viewed — used when switching
// branches (chat/branch/route.ts). Ordinary message creation never needs
// this directly: addMessage() below already moves the head to whatever it
// just created.
export function setHead(conversationId: string, messageId: string) {
  db.prepare(`UPDATE conversations SET head_message_id = ? WHERE id = ?`).run(messageId, conversationId);
}

// Walks parent_id from the conversation's current head up to the root and
// reverses it — the messages the user is actually looking at right now, as
// opposed to listMessages()'s every-branch flat list. This is what history
// building, episode closing, and the conversation view should use; raw
// listMessages() is only for whole-conversation bookkeeping (export, cascade
// cleanup) where every branch genuinely matters.
export function getActivePath(conversationId: string): Message[] {
  const convo = getConversation(conversationId);
  if (!convo?.head_message_id) return [];
  const all = listMessages(conversationId);
  const byId = new Map(all.map((m) => [m.id, m]));
  const path: Message[] = [];
  let current: string | null = convo.head_message_id;
  // Bounded by the conversation's own size — a defensive guard against a
  // corrupted/cyclic parent chain looping forever, not an expected case.
  for (let i = 0; current && i <= all.length; i++) {
    const message: Message | undefined = byId.get(current);
    if (!message) break;
    path.push(message);
    current = message.parent_id;
  }
  return path.reverse();
}

// The id a message will be saved under, before it is saved. Exists so a caller
// can name the message it is about to add and act on that name first — the
// chat route starts retrieval, which has to exclude this message, before the
// message itself is written. Pass the result as addMessage's `id`.
export function newMessageId(): string {
  return newId("msg");
}

export function addMessage(input: {
  conversationId: string;
  role: Message["role"];
  content: string;
  model?: string;
  provenance?: unknown;
  // A pre-allocated id from newMessageId(). Omitted → generated here, which is
  // what every caller with nothing to say about the message beforehand does.
  id?: string;
  // Which message this one continues from. Omitted → defaults to the
  // conversation's current head, i.e. "append to whatever is currently the
  // tip" — correct for a plain new turn, since nothing can move the head out
  // from under a synchronous call like this one. A caller whose insert
  // happens after an await (chatTurn.ts's assistant-reply persistence, which
  // runs seconds later once streaming finishes) must pass this explicitly
  // instead of relying on the default, or a branch switch mid-turn could
  // attach the reply to the wrong node — see runChatTurn's `parentId`.
  parentId?: string | null;
}): Message {
  const id = input.id ?? newId("msg");
  const ts = nowIso();
  const parentId = input.parentId !== undefined ? input.parentId : (getConversation(input.conversationId)?.head_message_id ?? null);
  db.prepare(
    `INSERT INTO messages (id, conversation_id, role, content, model, provenance, created_at, parent_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.conversationId,
    input.role,
    input.content,
    input.model ?? null,
    input.provenance ? JSON.stringify(input.provenance) : null,
    ts,
    parentId
  );
  // Every message ever added is meant to become "what you're now looking
  // at" — a plain new turn, an edited branch, or a regenerated reply all
  // want the same thing here.
  db.prepare(`UPDATE conversations SET updated_at = ?, head_message_id = ? WHERE id = ?`).run(ts, id, input.conversationId);

  const convo = getConversation(input.conversationId);
  if (convo) {
    indexUpsert({
      kind: "message",
      refId: id,
      projectId: convo.project_id,
      title: `${input.role} message in ${convo.title}`,
      content: input.content,
      sourceDate: ts,
    });
    // Auto-title fresh conversations from the first user message.
    if (convo.title === "Untitled conversation" && input.role === "user") {
      const title = input.content.slice(0, 60).split("\n")[0];
      renameConversation(convo.id, title || "Untitled conversation");
    }
  }
  return db.prepare(`SELECT * FROM messages WHERE id = ?`).get(id) as Message;
}
