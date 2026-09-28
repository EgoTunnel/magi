import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "../helpers/reset";
import { installMockProvider, type MockProvider } from "../helpers/provider";
import { __setJudgesForTests, type JudgeAnswer, type JudgeOptions, type JudgeProvider } from "@/lib/models/judge";
import { createProject } from "@/lib/repo/projects";
import { addMessage, createConversation, listMessages } from "@/lib/repo/conversations";
import { createProjectNote, getProjectNote, listProjectNotes } from "@/lib/repo/projectNotes";
import { listProposedSignals, getStandingSignal } from "@/lib/repo/standingSignals";
import { recentUsageEvents } from "@/lib/repo/usage";
import { setStandingWatchEnabled } from "@/lib/settings";
import {
  acceptStandingSignal,
  buildWatchQuestions,
  dismissStandingSignal,
  listWatchedNotes,
  runStandingWatch,
  watchState,
  WATCH_THRESHOLD,
} from "@/lib/standingWatch";
import { resolveTurnModel, runChatTurn } from "@/lib/chatTurn";

// A judge that answers whatever the test says, keyed by the question's
// instructions text, and records what it was asked.
function installMockJudge(answerFor: (key: string, instructions: string) => number | null) {
  const calls: JudgeOptions[] = [];
  const judge: JudgeProvider = {
    id: "typesafe",
    label: "Mock judge",
    model: () => ({ provider: "typesafe", modelId: "mock-jev" }),
    isConfigured: () => true,
    async judge(opts) {
      calls.push(opts);
      opts.usage?.push({ promptTokens: Math.ceil(opts.state.length / 4), completionTokens: 0 });
      const out: Record<string, JudgeAnswer> = {};
      for (const [key, q] of Object.entries(opts.questions)) {
        const p = answerFor(key, q.instructions);
        if (p !== null) out[key] = { type: "noul", probability: p, confidence: 0.9 };
      }
      return out;
    },
  };
  const restore = __setJudgesForTests([judge]);
  return { calls, restore };
}

let mock: MockProvider;
let restoreJudge: (() => void) | null = null;

beforeEach(() => {
  resetDb();
  mock = installMockProvider();
});
afterEach(() => {
  mock.restore();
  restoreJudge?.();
  restoreJudge = null;
});

function seed() {
  const project = createProject({ name: "Kestrel" });
  const conversation = createConversation(project.id, "Retry budget");
  const open = createProjectNote({ projectId: project.id, kind: "question", content: "How many retries?", status: "open" });
  const settled = createProjectNote({
    projectId: project.id,
    kind: "decision",
    content: "Use SQLite, not Postgres.",
    status: "settled",
  });
  // Unreviewed proposals from a closing: the watch must not build on these.
  createProjectNote({ projectId: project.id, kind: "question", content: "Proposed question?", status: "proposed" });
  createProjectNote({ projectId: project.id, kind: "decision", content: "Proposed decision.", status: "proposed" });
  return { project, conversation, open, settled };
}

describe("what the watch asks", () => {
  it("watches kept notes only, one yes/no question each", () => {
    const { project, open, settled } = seed();
    const notes = listWatchedNotes(project.id);
    expect(notes.map((n) => n.id).sort()).toEqual([open.id, settled.id].sort());

    const questions = buildWatchQuestions(notes);
    expect(Object.keys(questions).sort()).toEqual([`d:${settled.id}`, `q:${open.id}`].sort());
    expect(questions[`q:${open.id}`]).toMatchObject({ type: "noul" });
    expect(questions[`q:${open.id}`].instructions).toContain("Open question: How many retries?");
    expect(questions[`d:${settled.id}`].instructions).toContain("Settled decision: Use SQLite, not Postgres.");
  });

  it("judges the exchange, keeping the tail when it is too long", () => {
    expect(watchState("q", "a")).toBe("User: q\n\nAssistant: a");
    const long = watchState("x".repeat(20000), "the answer is at the end");
    expect(long.length).toBeLessThanOrEqual(12000);
    expect(long.endsWith("the answer is at the end")).toBe(true);
  });
});

describe("runStandingWatch", () => {
  it("proposes a signal for each note over the threshold, and records the spend", async () => {
    const { project, conversation, open, settled } = seed();
    const judge = installMockJudge((key) => (key.startsWith("q:") ? 0.91 : 0.2));
    restoreJudge = judge.restore;

    const signals = await runStandingWatch({
      projectId: project.id,
      conversationId: conversation.id,
      messageId: "msg_1",
      userText: "So how many retries?",
      assistantText: "Three, capped, with backoff.",
    });

    expect(judge.calls).toHaveLength(1);
    expect(judge.calls[0].state).toContain("Three, capped");
    expect(Object.keys(judge.calls[0].questions)).toHaveLength(2);

    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({
      note_id: open.id,
      kind: "answered",
      conversation_id: conversation.id,
      message_id: "msg_1",
      probability: 0.91,
      judge: "typesafe",
      status: "proposed",
    });
    // The decision scored 0.2 and produced nothing.
    expect(listProposedSignals(project.id).map((s) => s.note_id)).toEqual([open.id]);
    expect(listProposedSignals(project.id)[0].conversation_title).toBe("Retry budget");
    expect(getProjectNote(settled.id)?.status).toBe("settled");

    // Nothing about a note changed — the watch proposes, only.
    expect(getProjectNote(open.id)?.status).toBe("open");

    const events = recentUsageEvents(5).filter((e) => e.source === "standing_watch");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ provider: "typesafe", model: "mock-jev", role: "judge", project_id: project.id });
    // Priced from the published input rate, so the ledger is not blind to it.
    expect(events[0].cost_usd).toBeGreaterThan(0);
  });

  it("refreshes a repeat sighting in the same conversation instead of stacking signals", async () => {
    const { project, conversation, open } = seed();
    let p = 0.75;
    const judge = installMockJudge((key) => (key.startsWith("q:") ? p : 0));
    restoreJudge = judge.restore;
    const turn = { projectId: project.id, conversationId: conversation.id, userText: "u", assistantText: "a" };

    await runStandingWatch({ ...turn, messageId: "msg_1" });
    p = 0.95;
    await runStandingWatch({ ...turn, messageId: "msg_2" });
    p = 0.8;
    await runStandingWatch({ ...turn, messageId: "msg_3" });

    const signals = listProposedSignals(project.id);
    expect(signals).toHaveLength(1);
    expect(signals[0].note_id).toBe(open.id);
    // Strongest sighting wins; latest message is the pointer.
    expect(signals[0].probability).toBe(0.95);
    expect(signals[0].message_id).toBe("msg_3");
  });

  it("does not re-propose in a conversation where the user already dismissed it", async () => {
    const { project, conversation } = seed();
    const judge = installMockJudge(() => 0.99);
    restoreJudge = judge.restore;
    const turn = { projectId: project.id, conversationId: conversation.id, messageId: null, userText: "u", assistantText: "a" };

    const first = await runStandingWatch(turn);
    expect(first).toHaveLength(2);
    for (const s of first) expect(dismissStandingSignal(s.id)?.status).toBe("dismissed");

    const again = await runStandingWatch(turn);
    expect(again).toHaveLength(0);
    expect(listProposedSignals(project.id)).toHaveLength(0);

    // A different conversation is new grounds.
    const other = createConversation(project.id, "Elsewhere");
    const elsewhere = await runStandingWatch({ ...turn, conversationId: other.id });
    expect(elsewhere).toHaveLength(2);
  });

  it("stays quiet below the threshold, with nothing to watch, when switched off, and when the judge fails", async () => {
    const { project, conversation } = seed();
    const turn = { projectId: project.id, conversationId: conversation.id, messageId: null, userText: "u", assistantText: "a" };

    const low = installMockJudge(() => WATCH_THRESHOLD - 0.01);
    expect(await runStandingWatch(turn)).toHaveLength(0);
    low.restore();

    setStandingWatchEnabled(false);
    const off = installMockJudge(() => 1);
    expect(await runStandingWatch(turn)).toHaveLength(0);
    expect(off.calls).toHaveLength(0);
    off.restore();
    setStandingWatchEnabled(true);

    const empty = createProject({ name: "Nothing kept" });
    const idle = installMockJudge(() => 1);
    expect(await runStandingWatch({ ...turn, projectId: empty.id })).toHaveLength(0);
    expect(idle.calls).toHaveLength(0);
    idle.restore();

    const broken: JudgeProvider = {
      id: "typesafe",
      label: "Broken",
      model: () => ({ provider: "typesafe", modelId: "x" }),
      isConfigured: () => true,
      judge: async () => {
        throw new Error("judge exploded");
      },
    };
    restoreJudge = __setJudgesForTests([broken]);
    // Never throws: this runs after a turn that already succeeded.
    await expect(runStandingWatch(turn)).resolves.toEqual([]);
  });

  it("falls back to the fast model when no TypeSafe key is configured", async () => {
    const { project, conversation, open } = seed();
    // The default judge list: TypeSafe (unconfigured — no key in the test
    // database) then the LLM fallback on the mock provider.
    mock.setDefaultReply((opts) => {
      const key = /^(q:\S+) \(yes\/no\)/m.exec(opts.messages[0].content as string)?.[1];
      return `<<<JUDGE>>>\n${key} :: 0.88 :: 0.7\n<<<END>>>`;
    });

    const signals = await runStandingWatch({
      projectId: project.id,
      conversationId: conversation.id,
      messageId: null,
      userText: "u",
      assistantText: "a",
    });
    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({ note_id: open.id, probability: 0.88, judge: "llm" });
    expect(mock.calls).toHaveLength(1);
    expect(mock.calls[0].model).toBe("mock-fast");
    const events = recentUsageEvents(5).filter((e) => e.source === "standing_watch");
    expect(events[0]).toMatchObject({ provider: "openrouter", model: "mock-fast", role: "judge" });
  });
});

describe("acting on a signal", () => {
  it("accepting an 'answered' signal resolves the question", async () => {
    const { project, conversation, open } = seed();
    restoreJudge = installMockJudge((key) => (key.startsWith("q:") ? 0.9 : 0)).restore;
    const [signal] = await runStandingWatch({
      projectId: project.id,
      conversationId: conversation.id,
      messageId: null,
      userText: "u",
      assistantText: "a",
    });

    const result = acceptStandingSignal(signal.id);
    expect(result?.signal.status).toBe("accepted");
    expect(result?.note?.id).toBe(open.id);
    expect(getProjectNote(open.id)?.status).toBe("resolved");
    expect(listProposedSignals(project.id)).toHaveLength(0);
    // Once handled, a signal cannot be handled again.
    expect(acceptStandingSignal(signal.id)).toBeNull();
    expect(dismissStandingSignal(signal.id)).toBeNull();
  });

  it("accepting a 'revisited' signal opens a question pointing back at the decision, which stays settled", async () => {
    const { project, conversation, settled } = seed();
    restoreJudge = installMockJudge((key) => (key.startsWith("d:") ? 0.9 : 0)).restore;
    const [signal] = await runStandingWatch({
      projectId: project.id,
      conversationId: conversation.id,
      messageId: null,
      userText: "u",
      assistantText: "a",
    });
    expect(signal.kind).toBe("revisited");

    const result = acceptStandingSignal(signal.id);
    expect(result?.note).toMatchObject({
      kind: "question",
      status: "open",
      content: "Revisit: Use SQLite, not Postgres.",
      conversation_id: conversation.id,
    });
    // The decision the user kept is not unsettled by a machine's say-so.
    expect(getProjectNote(settled.id)?.status).toBe("settled");
    expect(listProjectNotes(project.id, { kind: "question", status: ["open"] })).toHaveLength(2);
  });

  it("a resolved question's stale signal stops being listed, and a deleted note takes its signal with it", async () => {
    const { project, conversation, open } = seed();
    restoreJudge = installMockJudge((key) => (key.startsWith("q:") ? 0.9 : 0)).restore;
    const [signal] = await runStandingWatch({
      projectId: project.id,
      conversationId: conversation.id,
      messageId: null,
      userText: "u",
      assistantText: "a",
    });
    const { setProjectNoteStatus, deleteProjectNote } = await import("@/lib/repo/projectNotes");
    setProjectNoteStatus(open.id, "resolved");
    expect(listProposedSignals(project.id)).toHaveLength(0);
    deleteProjectNote(open.id);
    expect(getStandingSignal(signal.id)).toBeNull();
  });
});

describe("the chat turn hook", () => {
  it("runs the watch on the completed exchange after the reply is saved", async () => {
    const { project, conversation, open } = seed();
    const judge = installMockJudge((key) => (key.startsWith("q:") ? 0.9 : 0));
    restoreJudge = judge.restore;
    const asking = addMessage({ conversationId: conversation.id, role: "user", content: "How many retries then?" });
    mock.reply("Three, with exponential backoff.");

    const turnModel = await resolveTurnModel("default", asking.content, null);
    if (!turnModel.ok) throw new Error("model did not resolve");
    const response = await runChatTurn({
      conversationId: conversation.id,
      projectId: project.id,
      history: listMessages(conversation.id).map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
      skillId: null,
      turnModel: turnModel.value,
      signal: new AbortController().signal,
      excludeRefIds: [asking.id],
      parentId: asking.id,
    });
    await response.text();

    // Fire-and-forget: give it a moment, but never more than a moment.
    for (let i = 0; i < 50 && judge.calls.length === 0; i++) await new Promise((r) => setTimeout(r, 10));
    expect(judge.calls).toHaveLength(1);
    expect(judge.calls[0].state).toBe("User: How many retries then?\n\nAssistant: Three, with exponential backoff.");

    for (let i = 0; i < 50 && listProposedSignals(project.id).length === 0; i++) await new Promise((r) => setTimeout(r, 10));
    const signals = listProposedSignals(project.id);
    expect(signals).toHaveLength(1);
    expect(signals[0].note_id).toBe(open.id);
    const reply = listMessages(conversation.id).find((m) => m.role === "assistant");
    expect(signals[0].message_id).toBe(reply?.id);
  });
});
