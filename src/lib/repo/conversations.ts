import { db, newId, nowIso } from "@/lib/db";
import { indexRemove, indexUpsert } from "@/lib/searchIndex";

export interface Conversation {
  id: string;
  project_id: string;
  title: string;
  status: "active" | "archived";
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  model: string | null;
  provenance: string | null;
  created_at: string;
}

export function listConversations(projectId: string): Conversation[] {
  return db
    .prepare(`SELECT * FROM conversations WHERE project_id = ? ORDER BY updated_at DESC`)
    .all(projectId) as Conversation[];
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

export function deleteConversation(id: string) {
  db.prepare(`DELETE FROM conversations WHERE id = ?`).run(id);
  indexRemove("conversation", id);
  const messages = db.prepare(`SELECT id FROM messages WHERE conversation_id = ?`).all(id) as {
    id: string;
  }[];
  for (const m of messages) indexRemove("message", m.id);
}

export function listMessages(conversationId: string): Message[] {
  return db
    .prepare(`SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC`)
    .all(conversationId) as Message[];
}

// Used by regenerate (chat/regenerate/route.ts) to discard the assistant
// reply being replaced. Artifacts aren't FK-enforced against messages (see
// db.ts's migrated message_id column), so any artifact this message produced
// is detached rather than deleted — the artifact and its version history
// survive, they just stop showing up as this (deleted) message's attachment.
export function deleteMessage(id: string) {
  db.prepare(`UPDATE artifacts SET message_id = NULL WHERE message_id = ?`).run(id);
  db.prepare(`DELETE FROM messages WHERE id = ?`).run(id);
  indexRemove("message", id);
}

export function addMessage(input: {
  conversationId: string;
  role: Message["role"];
  content: string;
  model?: string;
  provenance?: unknown;
}): Message {
  const id = newId("msg");
  const ts = nowIso();
  db.prepare(
    `INSERT INTO messages (id, conversation_id, role, content, model, provenance, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.conversationId,
    input.role,
    input.content,
    input.model ?? null,
    input.provenance ? JSON.stringify(input.provenance) : null,
    ts
  );
  db.prepare(`UPDATE conversations SET updated_at = ? WHERE id = ?`).run(ts, input.conversationId);

  const convo = getConversation(input.conversationId);
  if (convo) {
    indexUpsert({
      kind: "message",
      refId: id,
      projectId: convo.project_id,
      title: `${input.role} message in ${convo.title}`,
      content: input.content,
    });
    // Auto-title fresh conversations from the first user message.
    if (convo.title === "Untitled conversation" && input.role === "user") {
      const title = input.content.slice(0, 60).split("\n")[0];
      renameConversation(convo.id, title || "Untitled conversation");
    }
  }
  return db.prepare(`SELECT * FROM messages WHERE id = ?`).get(id) as Message;
}
