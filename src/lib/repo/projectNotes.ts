import { db, newId, nowIso } from "@/lib/db";

// What a Project has settled, and what it still hasn't. Both come out of
// closing a conversation (src/lib/episodeClose.ts) as 'proposed' drafts that
// nothing acts on until a human keeps them — the same posture memory already
// takes, for the same reason.
export interface ProjectNote {
  id: string;
  project_id: string;
  kind: "decision" | "question";
  content: string;
  status: "proposed" | "open" | "settled" | "resolved";
  conversation_id: string | null;
  closure_id: string | null;
  created_at: string;
  updated_at: string;
}

export function listProjectNotes(
  projectId: string,
  opts: { status?: ProjectNote["status"][]; kind?: ProjectNote["kind"] } = {}
): ProjectNote[] {
  const conditions = ["project_id = ?"];
  const params: unknown[] = [projectId];
  if (opts.status?.length) {
    conditions.push(`status IN (${opts.status.map(() => "?").join(",")})`);
    params.push(...opts.status);
  }
  if (opts.kind) {
    conditions.push("kind = ?");
    params.push(opts.kind);
  }
  return db
    .prepare(`SELECT * FROM project_notes WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC`)
    .all(...params) as ProjectNote[];
}

export function listNotesForClosure(closureId: string): ProjectNote[] {
  return db
    .prepare(`SELECT * FROM project_notes WHERE closure_id = ? ORDER BY kind ASC, created_at ASC`)
    .all(closureId) as ProjectNote[];
}

export function createProjectNote(input: {
  projectId: string;
  kind: ProjectNote["kind"];
  content: string;
  status?: ProjectNote["status"];
  conversationId?: string | null;
  closureId?: string | null;
}): ProjectNote {
  const id = newId("note");
  const ts = nowIso();
  db.prepare(
    `INSERT INTO project_notes (id, project_id, kind, content, status, conversation_id, closure_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.projectId,
    input.kind,
    input.content,
    input.status ?? "proposed",
    input.conversationId ?? null,
    input.closureId ?? null,
    ts,
    ts
  );
  return db.prepare(`SELECT * FROM project_notes WHERE id = ?`).get(id) as ProjectNote;
}

export function setProjectNoteStatus(id: string, status: ProjectNote["status"]): ProjectNote | null {
  db.prepare(`UPDATE project_notes SET status = ?, updated_at = ? WHERE id = ?`).run(status, nowIso(), id);
  return (db.prepare(`SELECT * FROM project_notes WHERE id = ?`).get(id) as ProjectNote) ?? null;
}

export function deleteProjectNote(id: string) {
  db.prepare(`DELETE FROM project_notes WHERE id = ?`).run(id);
}

// Clears the un-reviewed drafts belonging to one conversation, so re-closing an
// episode replaces its previous proposal rather than duplicating it. Anything
// the user already kept ('open'/'settled'/'resolved') is deliberately left
// alone — a redraft must never quietly delete a decision someone accepted.
export function clearProposedNotes(conversationId: string) {
  db.prepare(`DELETE FROM project_notes WHERE conversation_id = ? AND status = 'proposed'`).run(conversationId);
}
