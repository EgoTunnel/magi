import { getJudge, type JudgeQuestion } from "@/lib/models/judge";
import type { TokenUsage } from "@/lib/models/types";
import {
  createProjectNote,
  getProjectNote,
  listProjectNotes,
  setProjectNoteStatus,
  type ProjectNote,
} from "@/lib/repo/projectNotes";
import {
  getStandingSignal,
  setStandingSignalStatus,
  upsertStandingSignal,
  type StandingSignal,
} from "@/lib/repo/standingSignals";
import { recordUsage } from "@/lib/repo/usage";
import { getStandingWatchEnabled } from "@/lib/settings";

// A Project's Standing — its open questions and settled decisions — is fed at
// the end of an episode, by closing a conversation. That is the right time to
// *write* it, and the wrong time to *notice* things: an open question that
// got answered on Tuesday sits open until someone closes the conversation on
// Friday, and a decision that a conversation quietly walked back stays
// "settled" until someone remembers to check.
//
// The watch is the noticing. After every turn it asks, for every open
// question, "did this exchange answer it?" and for every settled decision,
// "did this exchange reopen it?" — one judge call, all questions in
// parallel, typed answers back. Anything over the threshold becomes a signal
// on the Standing band: "this may have been answered in <conversation>",
// with Resolve/Dismiss beside it. Nothing changes a note on its own; the
// watch proposes, the user disposes, same as every other inference in Magi.
//
// This is cheap enough to do every turn only because a judge is a judge (see
// src/lib/models/judge.ts): the state is one exchange, the questions are
// yes/no, and the answer is a number rather than a paragraph to parse.

// The probability at which a sighting is worth the user's attention. Below
// this the watch says nothing — a band full of 40% maybes would be worse
// than no band at all.
export const WATCH_THRESHOLD = 0.7;
// The exchange being judged: the user's message and the reply. Bounded so
// one enormous pasted document doesn't become the whole state; the tail is
// kept because the reply, where an answer would be, is at the end.
const STATE_BUDGET = 12000;
// A Project with hundreds of open questions is a Project that needs its
// questions pruned, not a bigger watch. Newest first, since those are the
// ones the current conversations are likeliest to be about.
const MAX_NOTES_PER_KIND = 40;

export interface WatchTurn {
  projectId: string;
  conversationId: string;
  // The assistant reply that completed the exchange.
  messageId: string | null;
  userText: string;
  assistantText: string;
}

const questionKey = (note: ProjectNote) => `${note.kind === "question" ? "q" : "d"}:${note.id}`;

// The notes worth watching: questions the user kept as open, decisions the
// user kept as settled. Proposals from an unreviewed closing are skipped —
// the watch must not build on a note nobody has agreed is real.
export function listWatchedNotes(projectId: string): ProjectNote[] {
  return [
    ...listProjectNotes(projectId, { kind: "question", status: ["open"] }).slice(0, MAX_NOTES_PER_KIND),
    ...listProjectNotes(projectId, { kind: "decision", status: ["settled"] }).slice(0, MAX_NOTES_PER_KIND),
  ];
}

// One yes/no question per note. Literal on purpose: the judge is asked about
// what the exchange *says*, not what it implies, and "substantially" is there
// so a partial answer that settles the real point still counts.
export function buildWatchQuestions(notes: ProjectNote[]): Record<string, JudgeQuestion> {
  const questions: Record<string, JudgeQuestion> = {};
  for (const note of notes) {
    questions[questionKey(note)] =
      note.kind === "question"
        ? {
            type: "noul",
            instructions:
              "The content is one exchange from a working conversation. Does this exchange answer the " +
              "following open question, fully or substantially? Only count an actual answer stated in the " +
              `content, not a mention of the topic.\n\nOpen question: ${note.content}`,
          }
        : {
            type: "noul",
            instructions:
              "The content is one exchange from a working conversation. Does this exchange revisit, reopen, " +
              "reverse, or contradict the following decision that was previously settled? Only count a real " +
              `change of position stated in the content, not a mention of the topic.\n\nSettled decision: ${note.content}`,
          };
  }
  return questions;
}

export function watchState(userText: string, assistantText: string): string {
  const text = `User: ${userText.trim()}\n\nAssistant: ${assistantText.trim()}`;
  return text.length > STATE_BUDGET ? text.slice(-STATE_BUDGET) : text;
}

// Runs the watch over one completed exchange. Never throws: this is a side
// effect of a turn that already succeeded, and a judge that is down must not
// turn into an error in the conversation.
export async function runStandingWatch(turn: WatchTurn): Promise<StandingSignal[]> {
  try {
    if (!getStandingWatchEnabled()) return [];
    const notes = listWatchedNotes(turn.projectId);
    if (!notes.length) return [];
    const judge = getJudge();
    if (!judge) return [];

    const usage: TokenUsage[] = [];
    const answers = await judge.judge({
      state: watchState(turn.userText, turn.assistantText),
      questions: buildWatchQuestions(notes),
      usage,
    });
    const billed = judge.model();
    recordUsage({
      projectId: turn.projectId,
      source: "standing_watch",
      sourceId: turn.conversationId,
      provider: billed.provider,
      model: billed.modelId,
      role: "judge",
      usage,
    });

    const signals: StandingSignal[] = [];
    for (const note of notes) {
      const answer = answers[questionKey(note)];
      if (!answer || answer.type !== "noul" || answer.probability < WATCH_THRESHOLD) continue;
      const signal = upsertStandingSignal({
        projectId: turn.projectId,
        noteId: note.id,
        kind: note.kind === "question" ? "answered" : "revisited",
        conversationId: turn.conversationId,
        messageId: turn.messageId,
        probability: answer.probability,
        confidence: answer.confidence,
        judge: judge.id,
      });
      if (signal) signals.push(signal);
    }
    return signals;
  } catch (err) {
    console.error("[standingWatch] failed", err instanceof Error ? err.message : err);
    return [];
  }
}

// The two things a user can do with a signal. Accepting is the only place
// the watch touches a note, and it is the user doing it, not the watch.
//
// An answered question is resolved. A revisited decision is *not* unsettled
// — a decision the user kept stays kept until they remove it — but the
// revisiting becomes an open question pointing back at it, which is what
// "we may need to look at this again" actually is in Standing's vocabulary.
export function acceptStandingSignal(id: string): { signal: StandingSignal; note: ProjectNote | null } | null {
  const signal = getStandingSignal(id);
  if (!signal || signal.status !== "proposed") return null;
  const note = getProjectNote(signal.note_id);
  if (!note) return null;

  let result: ProjectNote | null = null;
  if (signal.kind === "answered") {
    result = setProjectNoteStatus(note.id, "resolved");
  } else {
    result = createProjectNote({
      projectId: signal.project_id,
      kind: "question",
      content: `Revisit: ${note.content}`,
      status: "open",
      conversationId: signal.conversation_id,
    });
  }
  const updated = setStandingSignalStatus(id, "accepted");
  return updated ? { signal: updated, note: result } : null;
}

export function dismissStandingSignal(id: string): StandingSignal | null {
  const signal = getStandingSignal(id);
  if (!signal || signal.status !== "proposed") return null;
  return setStandingSignalStatus(id, "dismissed");
}
