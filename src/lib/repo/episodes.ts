import { db, newId, nowIso } from "@/lib/db";

// A conversation is an episode; this is the record of one being closed. The
// row itself holds only the summary and how far it read — the proposals it
// made live as ordinary memory and project_notes rows, in 'suggested' and
// 'proposed' states, so they survive the dialog being dismissed and can be
// reviewed later from the Memory page or the Project dashboard.
export interface EpisodeClosure {
  id: string;
  conversation_id: string;
  project_id: string;
  summary: string;
  message_count: number;
  through_message_id: string | null;
  status: "draft" | "reviewed";
  created_at: string;
  updated_at: string;
}

export function getClosureForConversation(conversationId: string): EpisodeClosure | null {
  return (
    (db
      .prepare(`SELECT * FROM episode_closures WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 1`)
      .get(conversationId) as EpisodeClosure) ?? null
  );
}

export function getClosure(id: string): EpisodeClosure | null {
  return (db.prepare(`SELECT * FROM episode_closures WHERE id = ?`).get(id) as EpisodeClosure) ?? null;
}

export function createClosure(input: {
  conversationId: string;
  projectId: string;
  summary: string;
  messageCount: number;
  throughMessageId: string | null;
}): EpisodeClosure {
  const id = newId("epi");
  const ts = nowIso();
  db.prepare(
    `INSERT INTO episode_closures
     (id, conversation_id, project_id, summary, message_count, through_message_id, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?)`
  ).run(id, input.conversationId, input.projectId, input.summary, input.messageCount, input.throughMessageId, ts, ts);
  return getClosure(id)!;
}

export function markClosureReviewed(id: string): EpisodeClosure | null {
  db.prepare(`UPDATE episode_closures SET status = 'reviewed', updated_at = ? WHERE id = ?`).run(nowIso(), id);
  return getClosure(id);
}

// Removes the previous draft for a conversation before a fresh one replaces
// it. Only the closure row: its proposals are cleaned up separately by the
// repos that own them, which know to spare anything already kept.
export function deleteClosuresForConversation(conversationId: string) {
  db.prepare(`DELETE FROM episode_closures WHERE conversation_id = ?`).run(conversationId);
}
