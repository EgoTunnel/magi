import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDb } from "../helpers/reset";
import { installMockProvider, type MockProvider } from "../helpers/provider";
import { db } from "@/lib/db";
import { setSetting } from "@/lib/settings";
import { createProject } from "@/lib/repo/projects";
import { addMessage, createConversation, getActivePath, getMessage } from "@/lib/repo/conversations";
import { createCouncilRun, getCouncilRun, listPendingCouncilRunsForConversation, updateCouncilRun } from "@/lib/repo/councils";
import { listMemory } from "@/lib/repo/memory";
import {
  askCouncilFromConversation,
  conversationContext,
  formatCouncilReply,
  postCouncilResult,
} from "@/lib/councilInConversation";
import {
  acceptMemorySuggestion,
  dismissMemorySuggestion,
  draftMemory,
  judgeMemoryWorth,
  readDraft,
} from "@/lib/memorySuggestions";
import { resolveTurnModel, runChatTurn } from "@/lib/chatTurn";

let mock: MockProvider;
beforeEach(() => {
  resetDb();
  mock = installMockProvider();
});
afterEach(() => {
  mock.restore();
  vi.unstubAllGlobals();
});

function exchange(conversationId: string, question: string, answer: string) {
  const asked = addMessage({ conversationId, role: "user", content: question });
  const replied = addMessage({ conversationId, role: "assistant", content: answer, parentId: asked.id });
  return { asked, replied };
}

describe("Ask the Council from a conversation", () => {
  it("gives the Council the conversation up to the message asked about, and no further", () => {
    const project = createProject({ name: "P" });
    const conversation = createConversation(project.id, "Talk");
    const first = exchange(conversation.id, "Should we migrate?", "Probably, in spring.");
    exchange(conversation.id, "Unrelated later turn", "LATER_ANSWER");

    const context = conversationContext(conversation.id, first.replied.id);
    expect(context).toContain("User: Should we migrate?");
    expect(context).toContain("Magi: Probably, in spring.");
    expect(context).not.toContain("LATER_ANSWER");
  });

  it("deliberates in the background and posts the question and conclusion into the thread", async () => {
    const project = createProject({ name: "P" });
    const conversation = createConversation(project.id, "Talk");
    const { replied } = exchange(conversation.id, "Should we migrate?", "Probably.");
    mock.setDefaultReply((opts) =>
      opts.system?.includes("You are the Synthesizer")
        ? "Consensus: Moderate\n\nKey disagreement: Timing.\n\nSynthesis: Migrate, but not before spring."
        : "A member's view."
    );

    const run = askCouncilFromConversation({
      conversationId: conversation.id,
      messageId: replied.id,
      question: "Should we migrate?",
      mode: "independent",
    });
    expect(listPendingCouncilRunsForConversation(conversation.id).map((r) => r.id)).toEqual([run.id]);
    // Members read the conversation as material.
    expect(getCouncilRun(run.id)!.attachments[0].extractedText).toContain("User: Should we migrate?");

    await vi.waitFor(() => expect(getCouncilRun(run.id)!.result_message_id).toBeTruthy(), { timeout: 5000 });

    const path = getActivePath(conversation.id);
    const [question, answer] = path.slice(-2);
    expect(question.role).toBe("user");
    expect(question.content).toBe("Asked the Magi Council (Independent Analysis): Should we migrate?");
    expect(answer.role).toBe("assistant");
    expect(answer.model).toBe("magi-council");
    expect(answer.parent_id).toBe(question.id);
    expect(answer.content).toContain("Migrate, but not before spring.");
    expect(answer.content).toContain("**Where the Council disagreed:** Timing.");
    expect(answer.content).toContain(`(/councils/runs/${run.id})`);
    expect(listPendingCouncilRunsForConversation(conversation.id)).toHaveLength(0);
  });

  it("waits for a reply in flight before posting, so neither lands on a hidden branch", async () => {
    const project = createProject({ name: "P" });
    const conversation = createConversation(project.id, "Talk");
    const { replied } = exchange(conversation.id, "Q1", "A1");
    const run = createCouncilRun({
      projectId: project.id,
      question: "Q1",
      conversationId: conversation.id,
      sourceMessageId: replied.id,
    });
    updateCouncilRun(run.id, { status: "complete", consensus: "Strong", synthesis: "Yes.", disagreement: "None" });

    // The user has sent another message whose reply is still streaming.
    const inFlight = addMessage({ conversationId: conversation.id, role: "user", content: "Q2" });
    const posting = postCouncilResult(run.id, { pollMs: 10, maxWaitMs: 2000 });
    await new Promise((r) => setTimeout(r, 50));
    addMessage({ conversationId: conversation.id, role: "assistant", content: "A2", parentId: inFlight.id });
    await posting;

    expect(getActivePath(conversation.id).map((m) => m.content)).toEqual([
      "Q1",
      "A1",
      "Q2",
      "A2",
      "Asked the Magi Council (Independent Analysis): Q1",
      formatCouncilReply(getCouncilRun(run.id)!),
    ]);
    // Posted once, however many times it's asked to.
    expect(await postCouncilResult(run.id)).toBeNull();
  });

  it("leaves a failed Council out of the pending list, and posts nothing", async () => {
    const project = createProject({ name: "P" });
    const conversation = createConversation(project.id, "Talk");
    const { replied } = exchange(conversation.id, "Q", "A");
    const run = createCouncilRun({ projectId: project.id, question: "Q", conversationId: conversation.id, sourceMessageId: replied.id });
    updateCouncilRun(run.id, { status: "error", synthesis: "Council failed: boom" });

    expect(listPendingCouncilRunsForConversation(conversation.id)).toHaveLength(0);
    expect(await postCouncilResult(run.id)).toBeNull();
    expect(getActivePath(conversation.id)).toHaveLength(2);
  });
});

describe("Worth remembering?", () => {
  // A stand-in Jev for the memory check.
  function stubJev(worth: number, scope: "project" | "global", delayMs = 0) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
        return Response.json({
          answers: { worth: { probability: worth }, scope: { choice: scope, confidence: 0.9 } },
          usage: { input_tokens: 60 },
        });
      })
    );
  }

  const judgeInput = (projectId: string, conversationId: string) => ({
    projectId,
    conversationId,
    userText: "We've decided: Postgres for every new service from now on.",
    replyText: "Noted — Postgres it is.",
  });

  it("suggests nothing without a TypeSafe key", async () => {
    expect(await judgeMemoryWorth(judgeInput("p", "c"))).toBeNull();
  });

  it("suggests when Jev is fairly sure, and records what it cost", async () => {
    setSetting("typesafe_api_key", "ts-test");
    stubJev(0.92, "global");
    const project = createProject({ name: "P" });
    expect(await judgeMemoryWorth(judgeInput(project.id, "c1"))).toEqual({ probability: 0.92, scope: "global", state: "open" });
    await vi.waitFor(() =>
      expect(db.prepare(`SELECT provider, role FROM usage_events WHERE role = 'memory_judge'`).get()).toEqual({
        provider: "typesafe",
        role: "memory_judge",
      })
    );
  });

  it("stays quiet when Jev isn't sure, or is too slow to wait for", async () => {
    setSetting("typesafe_api_key", "ts-test");
    stubJev(0.4, "project");
    expect(await judgeMemoryWorth(judgeInput("p", "c"))).toBeNull();
    stubJev(0.95, "project", 2000);
    expect(await judgeMemoryWorth(judgeInput("p", "c"))).toBeNull();
  });

  it("arrives with the reply: the saved message carries the suggestion", async () => {
    setSetting("typesafe_api_key", "ts-test");
    stubJev(0.88, "project");
    const project = createProject({ name: "P" });
    const conversation = createConversation(project.id, "Talk");
    const asking = addMessage({ conversationId: conversation.id, role: "user", content: "We've settled on Postgres." });
    mock.reply("Good choice.");

    const turnModel = await resolveTurnModel("default", asking.content, null);
    if (!turnModel.ok) throw new Error("model did not resolve");
    const response = await runChatTurn({
      conversationId: conversation.id,
      projectId: project.id,
      history: [{ role: "user", content: asking.content }],
      skillId: null,
      turnModel: turnModel.value,
      signal: new AbortController().signal,
      parentId: asking.id,
    });
    const lines = (await response.text()).split("\n").filter(Boolean).map((l) => JSON.parse(l));
    const done = lines.at(-1);
    expect(done.type).toBe("done");
    expect(JSON.parse(done.message.provenance).memorySuggestion).toEqual({ probability: 0.88, scope: "project", state: "open" });
    // And it's stored, not just sent.
    expect(JSON.parse(getMessage(done.message.id)!.provenance!).memorySuggestion.state).toBe("open");
  });

  it("drafts a one-line memory, keeping only what's between the delimiters", async () => {
    const project = createProject({ name: "P" });
    const conversation = createConversation(project.id, "Talk");
    const { replied } = exchange(conversation.id, "We've decided on Postgres.", "Noted.");
    mock.reply("Let me think about this first… <<<MEMORY>>>Decided to use Postgres for new services.<<<END>>> done");
    expect(await draftMemory(replied.id)).toEqual({ content: "Decided to use Postgres for new services.", scope: "project" });
    expect(readDraft('"Prefers short answers."')).toBe("Prefers short answers.");
  });

  it("keeps an accepted memory as established and linked to its reply; dismissing just closes it", () => {
    const project = createProject({ name: "P" });
    const conversation = createConversation(project.id, "Talk");
    const { replied } = exchange(conversation.id, "Q", "A");
    const suggestion = { probability: 0.9, scope: "project", state: "open" };
    db.prepare(`UPDATE messages SET provenance = ? WHERE id = ?`).run(JSON.stringify({ memorySuggestion: suggestion }), replied.id);

    const item = acceptMemorySuggestion(replied.id, "Decided on Postgres.", "project");
    expect(item).toMatchObject({ status: "established", scope: "project", project_id: project.id, source_message_id: replied.id });
    expect(listMemory({ projectId: project.id }).map((m) => m.content)).toContain("Decided on Postgres.");
    expect(JSON.parse(getMessage(replied.id)!.provenance!).memorySuggestion).toEqual({
      ...suggestion,
      state: "accepted",
      memoryId: item.id,
    });

    const other = exchange(conversation.id, "Q2", "A2").replied;
    db.prepare(`UPDATE messages SET provenance = ? WHERE id = ?`).run(JSON.stringify({ memorySuggestion: suggestion }), other.id);
    dismissMemorySuggestion(other.id);
    expect(JSON.parse(getMessage(other.id)!.provenance!).memorySuggestion.state).toBe("dismissed");
  });
});
