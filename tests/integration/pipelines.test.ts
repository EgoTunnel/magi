import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "../helpers/reset";
import { installMockProvider, type MockProvider } from "../helpers/provider";
import { db } from "@/lib/db";
import { createProject } from "@/lib/repo/projects";
import { addMessage, createConversation, listMessages, type Message } from "@/lib/repo/conversations";
import { createDocument } from "@/lib/repo/documents";
import { createMemory, listMemory } from "@/lib/repo/memory";
import { createSkill } from "@/lib/repo/skills";
import { buildHistoryWindow, getConversationSummary } from "@/lib/conversationWindow";
import { draftClosure } from "@/lib/episodeClose";
import { buildSystemPrompt } from "@/lib/contextBuilder";
import { createAgentRun, getAgentRun } from "@/lib/repo/agents";
import { runAgent } from "@/lib/agent";
import { runCouncilDeliberation } from "@/lib/council";
import { createCouncilRun, getCouncilRun } from "@/lib/repo/councils";

let mock: MockProvider;

beforeEach(() => {
  resetDb();
  mock = installMockProvider();
});
afterEach(() => mock.restore());

// Each message carries a unique marker and enough bulk to move the window,
// but not so much that a failed assertion prints pages of filler.
function seedMessages(conversationId: string, count: number, offset = 0): Message[] {
  return Array.from({ length: count }, (_, i) =>
    addMessage({
      conversationId,
      role: i % 2 === 0 ? "user" : "assistant",
      content: `MARK${offset + i}X ${"lorem ".repeat(700)}`,
    })
  );
}

describe("conversation window pipeline", () => {
  it("sends a short conversation whole and calls no model", async () => {
    const project = createProject({ name: "P" });
    const conversation = createConversation(project.id, "Talk");
    seedMessages(conversation.id, 4);

    const windowed = await buildHistoryWindow(conversation.id, listMessages(conversation.id));
    expect(windowed.summary).toBeNull();
    expect(windowed.history).toHaveLength(4);
    expect(mock.calls).toHaveLength(0);
  });

  it("summarizes older turns once a conversation gets long, and stores the summary", async () => {
    const project = createProject({ name: "P" });
    const conversation = createConversation(project.id, "Talk");
    seedMessages(conversation.id, 60);
    mock.setDefaultReply("**Earlier** The conversation settled on a September date.");

    const windowed = await buildHistoryWindow(conversation.id, listMessages(conversation.id));
    expect(mock.calls).toHaveLength(1);
    expect(windowed.summary).toContain("September date");
    expect(windowed.summarizedCount).toBeGreaterThan(0);
    expect(windowed.history.length).toBeLessThan(60);
    expect(getConversationSummary(conversation.id).summary).toContain("September date");
  });

  it("reuses a stored summary instead of paying for it again", async () => {
    const project = createProject({ name: "P" });
    const conversation = createConversation(project.id, "Talk");
    seedMessages(conversation.id, 60);
    mock.setDefaultReply("A summary.");

    await buildHistoryWindow(conversation.id, listMessages(conversation.id));
    expect(mock.calls).toHaveLength(1);
    await buildHistoryWindow(conversation.id, listMessages(conversation.id));
    expect(mock.calls).toHaveLength(1);
  });

  it("folds only the new material when the conversation grows further", async () => {
    const project = createProject({ name: "P" });
    const conversation = createConversation(project.id, "Talk");
    seedMessages(conversation.id, 60);
    mock.setDefaultReply("A summary.");
    await buildHistoryWindow(conversation.id, listMessages(conversation.id));

    seedMessages(conversation.id, 30, 60);
    await buildHistoryWindow(conversation.id, listMessages(conversation.id));

    expect(mock.calls).toHaveLength(2);
    // The second fold is given the prior summary plus only what came after it.
    expect(mock.calls[1].prompt).toContain("Summary of the conversation so far");
    expect(mock.calls[1].prompt).not.toContain("MARK0X");
  });

  it("falls back to the whole history when summarization fails", async () => {
    const project = createProject({ name: "P" });
    const conversation = createConversation(project.id, "Talk");
    seedMessages(conversation.id, 60);
    mock.failNext("provider exploded");

    const windowed = await buildHistoryWindow(conversation.id, listMessages(conversation.id));
    expect(windowed.summary).toBeNull();
    expect(windowed.history).toHaveLength(60);
  });
});

describe("context assembly", () => {
  it("retrieves passages for the turn's question instead of dumping documents", async () => {
    const project = createProject({ name: "P" });
    createDocument(project.id, "Irrelevant", "Filler about gardening. ".repeat(400));
    createDocument(project.id, "Relevant", "The migration runs on Tuesday at dawn. ".repeat(60));

    const { system, provenance } = await buildSystemPrompt({
      projectId: project.id,
      query: "when does the migration run",
    });
    expect(provenance.retrievalMode).toBe("retrieval");
    expect(system).toContain("Retrieved from this Project");
    expect(system).toContain("migration runs on Tuesday");
    expect(provenance.retrieved?.length).toBeGreaterThan(0);
  });

  it("falls back to whole documents when nothing matches", async () => {
    const project = createProject({ name: "P" });
    createDocument(project.id, "Doc", "Gardening notes about compost.");

    const { provenance } = await buildSystemPrompt({
      projectId: project.id,
      query: "zzzznonexistenttopic",
    });
    expect(provenance.retrievalMode).toBe("documents");
    expect(provenance.documentsUsed.length).toBeGreaterThan(0);
  });

  // The invariant the whole deliberate-memory design rests on.
  it("never puts suggested memory into the prompt", async () => {
    const project = createProject({ name: "P" });
    createMemory({ scope: "project", projectId: project.id, content: "ESTABLISHED_FACT", status: "established" });
    createMemory({ scope: "project", projectId: project.id, content: "SUGGESTED_FACT", status: "suggested" });

    const { system } = await buildSystemPrompt({ projectId: project.id, query: "anything" });
    expect(system).toContain("ESTABLISHED_FACT");
    expect(system).not.toContain("SUGGESTED_FACT");
  });

  it("dates every memory item and names where it came from", async () => {
    const project = createProject({ name: "P" });
    const conversation = createConversation(project.id, "Origin conversation");
    createMemory({
      scope: "project",
      projectId: project.id,
      content: "A remembered claim.",
      sourceConversationId: conversation.id,
    });

    const { system } = await buildSystemPrompt({ projectId: project.id, query: "anything" });
    expect(system).toMatch(/- \(\d{4}-\d{2}-\d{2}, from "Origin conversation"\) A remembered claim\./);
  });

  it("includes the rolling summary when one is supplied", async () => {
    const project = createProject({ name: "P" });
    const { system, provenance } = await buildSystemPrompt({
      projectId: project.id,
      query: "anything",
      conversationSummary: { text: "PRIOR_SUMMARY", messageCount: 42 },
    });
    expect(system).toContain("Earlier in this conversation");
    expect(system).toContain("PRIOR_SUMMARY");
    expect(provenance.summarizedMessages).toBe(42);
  });
});

describe("episode closing", () => {
  const REPLY = `<<<CLOSEOUT>>>
Summary:
The conversation settled the delivery date.

**Decisions:**
- Ship the deck by Sept 19.

Open questions:
- Does the co-CEO need a pre-brief?

Remember in this Project:
- The live session is Sept 21.

Remember globally:
None.
<<<END>>>`;

  it("turns a reply into inert proposals, not into memory", async () => {
    const project = createProject({ name: "P" });
    const conversation = createConversation(project.id, "Talk");
    addMessage({ conversationId: conversation.id, role: "user", content: "When is the session?" });
    mock.setDefaultReply(REPLY);

    const draft = await draftClosure(conversation.id);

    expect(draft.closure.summary).toBe("The conversation settled the delivery date.");
    expect(draft.notes.filter((n) => n.kind === "decision")).toHaveLength(1);
    expect(draft.notes.filter((n) => n.kind === "question")).toHaveLength(1);
    // Everything it proposes must be in a state nothing acts on.
    expect(draft.notes.every((n) => n.status === "proposed")).toBe(true);
    expect(draft.memory).toHaveLength(1);
    expect(draft.memory[0].status).toBe("suggested");
    expect(draft.memory[0].source_conversation_id).toBe(conversation.id);
  });

  it("keeps proposals out of the next prompt until they are established", async () => {
    const project = createProject({ name: "P" });
    const conversation = createConversation(project.id, "Talk");
    addMessage({ conversationId: conversation.id, role: "user", content: "When is the session?" });
    mock.setDefaultReply(REPLY);
    await draftClosure(conversation.id);

    const { system } = await buildSystemPrompt({ projectId: project.id, query: "session" });
    expect(system).not.toContain("The live session is Sept 21.");
  });

  it("replaces un-kept proposals on a redraft and spares the kept ones", async () => {
    const project = createProject({ name: "P" });
    const conversation = createConversation(project.id, "Talk");
    addMessage({ conversationId: conversation.id, role: "user", content: "q" });
    mock.setDefaultReply(REPLY);
    const first = await draftClosure(conversation.id);

    db.prepare(`UPDATE memory SET status = 'established' WHERE id = ?`).run(first.memory[0].id);
    db.prepare(`UPDATE project_notes SET status = 'settled' WHERE id = ?`).run(first.notes[0].id);

    const second = await draftClosure(conversation.id);
    expect(second.closure.id).not.toBe(first.closure.id);
    // The kept rows survive; the un-kept ones were replaced rather than doubled.
    expect(listMemory().filter((m) => m.status === "established")).toHaveLength(1);
    expect(second.memory).toHaveLength(1);
  });

  it("refuses to close an empty conversation", async () => {
    const project = createProject({ name: "P" });
    const conversation = createConversation(project.id, "Empty");
    await expect(draftClosure(conversation.id)).rejects.toThrow(/nothing in this conversation/i);
  });
});

describe("agent pipeline", () => {
  it("runs the built-in five stages and saves an artifact", async () => {
    const project = createProject({ name: "P" });
    const run = createAgentRun({ objective: "Investigate something", projectId: project.id });
    mock.setDefaultReply("Stage output.");

    await runAgent({ runId: run.id, objective: "Investigate something", projectId: project.id });

    const finished = getAgentRun(run.id)!;
    expect(finished.status).toBe("complete");
    expect(finished.steps.map((s) => s.type)).toEqual([
      "plan",
      "research",
      "draft",
      "critique",
      "revise",
      "final",
    ]);
    expect(finished.artifact_id).toBeTruthy();
  });

  it("runs a Skill's stages instead of the built-in pipeline", async () => {
    const project = createProject({ name: "P" });
    const skill = createSkill({
      scope: "global",
      name: "Two-Stage",
      instructions: "Method.",
      modelRole: "fast",
      stages: [
        { name: "List", instructions: "list things", modelRole: "fast", useTools: false },
        { name: "Pick", instructions: "pick one", modelRole: null, useTools: false },
      ],
    });
    const run = createAgentRun({ objective: "Choose", projectId: project.id, skillId: skill.id });
    mock.reply("Red, Yellow, Blue");
    mock.reply("Red.");

    await runAgent({ runId: run.id, objective: "Choose", projectId: project.id, skillId: skill.id });

    const finished = getAgentRun(run.id)!;
    expect(finished.status).toBe("complete");
    expect(finished.steps.map((s) => s.title)).toEqual(["List", "Pick", "Complete"]);
    expect(finished.steps[0].type).toBe("stage");
    // The second stage must actually see the first stage's output.
    expect(mock.calls[1].prompt).toContain("Red, Yellow, Blue");
    expect(mock.calls[1].system).toContain("Two-Stage");
  });

  it("records a provider failure as an error rather than hanging", async () => {
    const project = createProject({ name: "P" });
    const run = createAgentRun({ objective: "Fail", projectId: project.id });
    mock.failNext("429 Provider returned error");

    await runAgent({ runId: run.id, objective: "Fail", projectId: project.id });

    const finished = getAgentRun(run.id)!;
    expect(finished.status).toBe("error");
    expect(finished.steps[0].type).toBe("error");
    expect(finished.steps[0].content).toContain("429");
  });

  it("only offers tools to the stage that asked for them", async () => {
    const project = createProject({ name: "P" });
    const skill = createSkill({
      scope: "global",
      name: "Selective",
      instructions: "Method.",
      stages: [
        { name: "Think", instructions: "think", useTools: false },
        { name: "Look", instructions: "look things up", useTools: true },
      ],
    });
    const run = createAgentRun({ objective: "Go", projectId: project.id, skillId: skill.id });
    mock.setDefaultReply("output");

    await runAgent({ runId: run.id, objective: "Go", projectId: project.id, skillId: skill.id });

    expect(mock.calls[0].toolNames).toHaveLength(0);
    expect(mock.calls[1].toolNames.length).toBeGreaterThan(0);
  });
});

describe("council pipeline", () => {
  it("runs analysis, critique and synthesis, and preserves disagreement", async () => {
    const project = createProject({ name: "P" });
    const run = createCouncilRun({ question: "Is it wise?", projectId: project.id, mode: "independent" });
    mock.setDefaultReply(
      "Consensus: Moderate\n\nKey disagreement: They disagreed about timing.\n\nSynthesis: On balance, yes."
    );

    await runCouncilDeliberation({
      runId: run.id,
      question: "Is it wise?",
      projectId: project.id,
      mode: "independent",
      roles: [
        { name: "Reasoner", systemPrompt: "Reason.", modelRole: "reasoner" },
        { name: "Critic", systemPrompt: "Doubt.", modelRole: "critic" },
      ],
    });

    const finished = getCouncilRun(run.id)!;
    expect(finished.status).toBe("complete");
    expect(finished.consensus).toBe("Moderate");
    expect(finished.disagreement).toContain("timing");
    expect(finished.transcript.map((t) => t.stage)).toEqual([
      "analysis",
      "analysis",
      "critique",
      "critique",
      "synthesis",
    ]);
  });

  it("lets a member work by a Skill without overriding what the role states", async () => {
    const project = createProject({ name: "P" });
    const skill = createSkill({
      scope: "global",
      name: "Careful Method",
      instructions: "METHOD_MARKER",
      modelRole: "researcher",
    });
    const run = createCouncilRun({ question: "Q", projectId: project.id, mode: "independent" });
    mock.setDefaultReply("Consensus: Strong\n\nKey disagreement: None\n\nSynthesis: Yes.");

    await runCouncilDeliberation({
      runId: run.id,
      question: "Q",
      projectId: project.id,
      mode: "independent",
      roles: [
        // No modelRole of its own: the Skill's should be used.
        { name: "Member", systemPrompt: "ROLE_MARKER", modelRole: "", skillId: skill.id },
      ],
    });

    const first = mock.calls[0];
    expect(first.system).toContain("METHOD_MARKER");
    expect(first.system).toContain("ROLE_MARKER");
    expect(first.model).toBe("mock-researcher");
  });

  it("reports a failure on the run rather than throwing", async () => {
    const project = createProject({ name: "P" });
    const run = createCouncilRun({ question: "Q", projectId: project.id, mode: "independent" });
    mock.failNext("provider down");

    await runCouncilDeliberation({
      runId: run.id,
      question: "Q",
      projectId: project.id,
      mode: "independent",
      roles: [{ name: "One", systemPrompt: "x", modelRole: "default" }],
    });

    const finished = getCouncilRun(run.id)!;
    expect(finished.status).toBe("error");
    expect(finished.synthesis).toContain("provider down");
  });
});
