import { db, newId, nowIso } from "@/lib/db";
import { indexRemove, indexUpsert } from "@/lib/searchIndex";

export interface MemoryItem {
  id: string;
  // 'person' is a third scope, not a third kind of table: a fact about someone
  // is an ordinary memory row, so it inherits status, provenance, dating, and
  // the rule that a suggestion is inert. See src/lib/repo/people.ts.
  scope: "global" | "project" | "person";
  project_id: string | null;
  person_id: string | null;
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

// Note what neither branch below matches: scope = 'person'. That is the safety
// property the People feature rests on — a fact about someone can never be
// swept into the global or Project memory block of a system prompt just because
// it happens to live in the same table. Person facts are listed only by asking
// for them explicitly (personId), or by the unfiltered call the Memory page
// makes to show everything Magi holds.
export function listMemory(
  opts: { scope?: "global" | "project"; projectId?: string; personId?: string } = {}
): MemoryItem[] {
  if (opts.personId) {
    return db
      .prepare(`SELECT * FROM memory WHERE scope = 'person' AND person_id = ? ORDER BY created_at DESC`)
      .all(opts.personId) as MemoryItem[];
  }
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

// What a memory row is called in the search index and, through it, in the
// "Retrieved from this Project" block of a prompt. A person's facts are titled
// with their name rather than "person memory": a bare fact ("Runs the review
// process") is close to useless without knowing who it is about, and the title
// is what both the embedding and the citation carry.
//
// Deliberately a raw query rather than an import of the people repo — that repo
// imports this one, and a cycle here would be paid at module load.
function memoryTitle(scope: MemoryItem["scope"], personId: string | null): string {
  if (scope !== "person" || !personId) return `${scope} memory`;
  const row = db.prepare(`SELECT name FROM people WHERE id = ?`).get(personId) as { name: string } | undefined;
  return row ? row.name : "person memory";
}

export function createMemory(input: {
  scope: "global" | "project" | "person";
  projectId?: string;
  personId?: string;
  content: string;
  source?: string;
  status?: "established" | "suggested";
  closureId?: string | null;
  sourceMessageId?: string | null;
  sourceConversationId?: string | null;
}): MemoryItem {
  const id = newId("mem");
  const ts = nowIso();
  const personId = input.scope === "person" ? input.personId ?? null : null;
  db.prepare(
    `INSERT INTO memory
     (id, scope, project_id, person_id, content, source, status, closure_id, source_message_id, source_conversation_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.scope,
    input.scope === "project" ? input.projectId ?? null : null,
    personId,
    input.content,
    input.source ?? "manual",
    input.status ?? "established",
    input.closureId ?? null,
    input.sourceMessageId ?? null,
    input.sourceConversationId ?? null,
    ts
  );
  // A suggestion is not part of the archive yet. Filtering it out of the
  // memory *sections* of the prompt isn't enough on its own — an indexed
  // suggestion is retrievable, and passage retrieval would put it in front of
  // the model as a cited extract, which is exactly what "nothing acts on it
  // until you keep it" is supposed to prevent. It gets indexed on promotion.
  if ((input.status ?? "established") === "established") {
    indexUpsert({
      kind: "memory",
      refId: id,
      projectId: input.scope === "project" ? input.projectId ?? null : null,
      title: memoryTitle(input.scope, personId),
      content: input.content,
    });
  }
  return db.prepare(`SELECT * FROM memory WHERE id = ?`).get(id) as MemoryItem;
}

export function updateMemory(id: string, content: string): MemoryItem | null {
  db.prepare(`UPDATE memory SET content = ? WHERE id = ?`).run(content, id);
  const row = db.prepare(`SELECT * FROM memory WHERE id = ?`).get(id) as MemoryItem | undefined;
  // Editing a suggestion must not quietly index it — see createMemory.
  if (row && row.status === "established") {
    indexUpsert({
      kind: "memory",
      refId: id,
      projectId: row.project_id,
      title: memoryTitle(row.scope, row.person_id),
      content: row.content,
      sourceDate: row.created_at,
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
  const row = (db.prepare(`SELECT * FROM memory WHERE id = ?`).get(id) as MemoryItem) ?? null;
  if (!row) return null;
  // Promotion is what puts an item into the archive; demotion takes it back
  // out, so a suggestion can never be retrieved into a prompt.
  if (status === "established") {
    indexUpsert({
      kind: "memory",
      refId: id,
      projectId: row.project_id,
      title: memoryTitle(row.scope, row.person_id),
      content: row.content,
      sourceDate: row.created_at,
    });
  } else {
    indexRemove("memory", id);
  }
  return row;
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
