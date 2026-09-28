import { db, newId, nowIso } from "@/lib/db";

// What the Standing watch noticed, as rows. The watch itself lives in
// src/lib/standingWatch.ts; this is only storage and the two things a user
// can do with a signal.
export interface StandingSignal {
  id: string;
  project_id: string;
  note_id: string;
  // 'answered': an open question looks answered. 'revisited': a settled
  // decision looks reopened or contradicted.
  kind: "answered" | "revisited";
  conversation_id: string;
  // The assistant reply that closed the exchange being judged.
  message_id: string | null;
  probability: number;
  confidence: number | null;
  judge: string;
  status: "proposed" | "accepted" | "dismissed";
  created_at: string;
  updated_at: string;
}

// A signal as the Standing band shows it: with enough of its note and its
// conversation to read without a second request.
export interface StandingSignalView extends StandingSignal {
  conversation_title: string;
}

export function getStandingSignal(id: string): StandingSignal | null {
  return (db.prepare(`SELECT * FROM standing_signals WHERE id = ?`).get(id) as StandingSignal) ?? null;
}

// Proposed signals for notes that are still in the state the signal is about:
// an 'answered' signal on a question the user already resolved by hand has
// nothing left to propose, and a 'revisited' signal on a decision that was
// deleted goes with it (FK cascade). Ordered strongest first — the band
// shows probability, so the order should agree with it.
export function listProposedSignals(projectId: string): StandingSignalView[] {
  return db
    .prepare(
      `SELECT s.*, c.title AS conversation_title
       FROM standing_signals s
       JOIN project_notes n ON n.id = s.note_id
       JOIN conversations c ON c.id = s.conversation_id
       WHERE s.project_id = ? AND s.status = 'proposed'
         AND ((s.kind = 'answered' AND n.status = 'open') OR (s.kind = 'revisited' AND n.status = 'settled'))
       ORDER BY s.probability DESC, s.updated_at DESC`
    )
    .all(projectId) as StandingSignalView[];
}

// Records what the watch saw, one row per note per conversation. A repeat
// sighting in the same conversation refreshes the row (highest probability
// wins, latest message is kept) — a question that keeps coming up should not
// stack a signal per turn. A row the user already dismissed for this
// conversation is left dismissed: they said no to exactly this, and the
// watch has no new grounds to ask again until the topic moves to a
// different conversation.
export function upsertStandingSignal(input: {
  projectId: string;
  noteId: string;
  kind: StandingSignal["kind"];
  conversationId: string;
  messageId: string | null;
  probability: number;
  confidence: number | null;
  judge: string;
}): StandingSignal | null {
  const existing = db
    .prepare(`SELECT * FROM standing_signals WHERE note_id = ? AND conversation_id = ?`)
    .get(input.noteId, input.conversationId) as StandingSignal | undefined;
  const ts = nowIso();
  if (existing) {
    if (existing.status !== "proposed") return null;
    db.prepare(
      `UPDATE standing_signals
       SET probability = MAX(probability, ?), confidence = ?, message_id = ?, judge = ?, updated_at = ?
       WHERE id = ?`
    ).run(input.probability, input.confidence, input.messageId, input.judge, ts, existing.id);
    return getStandingSignal(existing.id);
  }
  const id = newId("sig");
  db.prepare(
    `INSERT INTO standing_signals
     (id, project_id, note_id, kind, conversation_id, message_id, probability, confidence, judge, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'proposed', ?, ?)`
  ).run(
    id,
    input.projectId,
    input.noteId,
    input.kind,
    input.conversationId,
    input.messageId,
    input.probability,
    input.confidence,
    input.judge,
    ts,
    ts
  );
  return getStandingSignal(id);
}

export function setStandingSignalStatus(id: string, status: StandingSignal["status"]): StandingSignal | null {
  db.prepare(`UPDATE standing_signals SET status = ?, updated_at = ? WHERE id = ?`).run(status, nowIso(), id);
  return getStandingSignal(id);
}
