import { db, newId, nowIso } from "@/lib/db";
import { indexRemove, indexUpsert } from "@/lib/searchIndex";

export interface MemoryItem {
  id: string;
  scope: "global" | "project";
  project_id: string | null;
  content: string;
  source: string | null;
  status: "established" | "suggested";
  // Set when this item was proposed by closing a conversation rather than
  // written by hand — see src/lib/episodeClose.ts.
  closure_id: string | null;
  // Where the claim came from. source_message_id is set when a specific
  // message was promoted; source_conversation_id is also set for items a whole
  // episode produced, where no single message is the origin.
  source_message_id: string | null;
  source_conversation_id: string | null;
  created_at: string;
}

export function listMemory(opts: { scope?: "global" | "project"; projectId?: string } = {}): MemoryItem[] {
  if (opts.scope === "global") {
    return db
      .prepare(`SELECT * FROM memory WHERE scope = 'global' ORDER BY created_at DESC`)
      .all() as MemoryItem[];
  }
  if (opts.projectId) {
    return db
      .prepare(
        `SELECT * FROM memory WHERE (scope = 'project' AND project_id = ?) OR scope = 'global'
         ORDER BY created_at DESC`
      )
      .all(opts.projectId) as MemoryItem[];
  }
  return db.prepare(`SELECT * FROM memory ORDER BY created_at DESC`).all() as MemoryItem[];
}

export function createMemory(input: {
  scope: "global" | "project";
  projectId?: string;
  content: string;
  source?: string;
  status?: "established" | "suggested";
  closureId?: string | null;
  sourceMessageId?: string | null;
  sourceConversationId?: string | null;
}): MemoryItem {
  const id = newId("mem");
  const ts = nowIso();
  db.prepare(
    `INSERT INTO memory
     (id, scope, project_id, content, source, status, closure_id, source_message_id, source_conversation_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.scope,
    input.scope === "project" ? input.projectId ?? null : null,
    input.content,
    input.source ?? "manual",
    input.status ?? "established",
    input.closureId ?? null,
    input.sourceMessageId ?? null,
    input.sourceConversationId ?? null,
    ts
  );
  indexUpsert({
    kind: "memory",
    refId: id,
    projectId: input.scope === "project" ? input.projectId ?? null : null,
    title: `${input.scope} memory`,
    content: input.content,
  });
  return db.prepare(`SELECT * FROM memory WHERE id = ?`).get(id) as MemoryItem;
}

export function updateMemory(id: string, content: string): MemoryItem | null {
  db.prepare(`UPDATE memory SET content = ? WHERE id = ?`).run(content, id);
  const row = db.prepare(`SELECT * FROM memory WHERE id = ?`).get(id) as MemoryItem | undefined;
  if (row) {
    indexUpsert({
      kind: "memory",
      refId: id,
      projectId: row.project_id,
      title: `${row.scope} memory`,
      content: row.content,
    });
  }
  return row ?? null;
}

export function deleteMemory(id: string) {
  db.prepare(`DELETE FROM memory WHERE id = ?`).run(id);
  indexRemove("memory", id);
}

// Promotion is the deliberate act the Vision insists on: a 'suggested' item is
// inert everywhere (buildSystemPrompt only ever reads 'established' ones) until
// a human says to keep it.
export function setMemoryStatus(id: string, status: MemoryItem["status"]): MemoryItem | null {
  db.prepare(`UPDATE memory SET status = ? WHERE id = ?`).run(status, id);
  return (db.prepare(`SELECT * FROM memory WHERE id = ?`).get(id) as MemoryItem) ?? null;
}

export function listMemoryForClosure(closureId: string): MemoryItem[] {
  return db
    .prepare(`SELECT * FROM memory WHERE closure_id = ? ORDER BY created_at ASC`)
    .all(closureId) as MemoryItem[];
}

// Drops the un-kept proposals from a conversation's previous closing so a
// redraft replaces them instead of piling up. Anything already promoted to
// 'established' is deliberately spared.
export function clearSuggestedForConversation(conversationId: string) {
  const rows = db
    .prepare(
      `SELECT m.id FROM memory m
       JOIN episode_closures c ON c.id = m.closure_id
       WHERE c.conversation_id = ? AND m.status = 'suggested'`
    )
    .all(conversationId) as { id: string }[];
  for (const row of rows) deleteMemory(row.id);
}
