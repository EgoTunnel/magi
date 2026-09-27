import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "../helpers/reset";
import { installMockProvider, type MockProvider } from "../helpers/provider";
import { createProject } from "@/lib/repo/projects";
import { addMessage, createConversation } from "@/lib/repo/conversations";
import { createCouncilRun, updateCouncilRun } from "@/lib/repo/councils";
import { createProjectNote, listProjectNotes } from "@/lib/repo/projectNotes";
import { draftCouncilDecision, readDecisionDraft, recordCouncilDecision } from "@/lib/councilDecisions";
import { buildSystemPrompt } from "@/lib/contextBuilder";
import { resolveTurnModel, runChatTurn } from "@/lib/chatTurn";
import { outputBudget } from "@/lib/models/openaiCompatible";
import { maxTokensFor } from "@/lib/models/anthropic";
import { CHAT_REPLY_MAX_TOKENS } from "@/lib/models/types";

let mock: MockProvider;
beforeEach(() => {
  resetDb();
  mock = installMockProvider();
});
afterEach(() => mock.restore());

function finishedRun(projectId: string | undefined, conversationId?: string) {
  const run = createCouncilRun({ projectId, question: "Which database for new services?", conversationId });
  updateCouncilRun(run.id, {
    status: "complete",
    consensus: "Moderate",
    disagreement: "Whether write volume will outgrow a single node.",
    synthesis: "Postgres, with a plan to revisit if writes grow.",
  });
  return run;
}

describe("Council decisions", () => {
  it("reads only what's inside the delimiters, and treats None as no open question", () => {
    expect(
      readDecisionDraft(
        "Thinking first… <<<DECISION>>>\nUse Postgres for new services.\n<<<END>>>\n<<<OPEN QUESTION>>>\nNone\n<<<END>>>"
      )
    ).toEqual({ decision: "Use Postgres for new services.", openQuestion: null });
    expect(() => readDecisionDraft("I think Postgres.")).toThrow(/didn't contain a decision/);
  });

  it("drafts a decision and an open question from the conclusion", async () => {
    const project = createProject({ name: "P" });
    const run = finishedRun(project.id);
    mock.reply(
      "<<<DECISION>>>Use Postgres for new services.<<<END>>>\n<<<OPEN QUESTION>>>Will writes outgrow one node?<<<END>>>"
    );
    expect(await draftCouncilDecision(run.id)).toEqual({
      decision: "Use Postgres for new services.",
      openQuestion: "Will writes outgrow one node?",
    });
    // Drafted from the conclusion itself.
    expect(mock.calls.at(-1)!.prompt).toContain("Postgres, with a plan to revisit if writes grow.");
  });

  it("records them as the Project's own — settled and open — linked to the deliberation", () => {
    const project = createProject({ name: "P" });
    const conversation = createConversation(project.id, "Talk");
    const run = finishedRun(project.id, conversation.id);

    const notes = recordCouncilDecision(run.id, {
      decision: "Use Postgres for new services.",
      openQuestion: "Will writes outgrow one node?",
    });
    expect(notes.map((n) => [n.kind, n.status, n.content])).toEqual([
      ["decision", "settled", "Use Postgres for new services."],
      ["question", "open", "Will writes outgrow one node?"],
    ]);
    expect(notes.every((n) => n.council_run_id === run.id && n.conversation_id === conversation.id)).toBe(true);
  });

  it("refuses to record a deliberation that has no Project", () => {
    const run = finishedRun(undefined);
    expect(() => recordCouncilDecision(run.id, { decision: "X" })).toThrow(/isn't in a Project/);
  });

  it("puts settled decisions and open questions into every turn's context — never proposals", async () => {
    const project = createProject({ name: "P" });
    const run = finishedRun(project.id);
    recordCouncilDecision(run.id, { decision: "DECIDED_POSTGRES", openQuestion: "OPEN_WRITE_VOLUME" });
    createProjectNote({ projectId: project.id, kind: "decision", content: "PROPOSED_ONLY", status: "proposed" });
    createProjectNote({ projectId: project.id, kind: "question", content: "RESOLVED_ONE", status: "resolved" });

    const { system, provenance } = await buildSystemPrompt({ projectId: project.id, query: "anything" });
    expect(system).toContain("## Where this Project stands");
    expect(system).toMatch(/- \(\d{4}-\d{2}-\d{2}, from a Council deliberation\) DECIDED_POSTGRES/);
    expect(system).toContain("OPEN_WRITE_VOLUME");
    expect(system).not.toContain("PROPOSED_ONLY");
    expect(system).not.toContain("RESOLVED_ONE");
    expect(provenance.decisionsInContext).toBe(1);
    expect(provenance.openQuestionsInContext).toBe(1);
    // Still exactly two notes kept from the Council.
    expect(listProjectNotes(project.id, { status: ["settled", "open"] })).toHaveLength(2);
  });
});

describe("reply length", () => {
  it("asks the provider for a long reply on every conversation turn", async () => {
    const project = createProject({ name: "P" });
    const conversation = createConversation(project.id, "Talk");
    const asking = addMessage({ conversationId: conversation.id, role: "user", content: "Write it all out." });
    mock.reply("Long answer.");
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
    await response.text();
    expect(mock.calls.at(-1)!.maxTokens).toBe(CHAT_REPLY_MAX_TOKENS);
  });

  it("clamps an Anthropic reply to what the model can write", () => {
    expect(maxTokensFor("claude-sonnet-5", CHAT_REPLY_MAX_TOKENS, 16000)).toBe(64000);
    expect(maxTokensFor("claude-haiku-4-5-20251001", 100000, 16000)).toBe(64000);
    expect(maxTokensFor("claude-opus-4-8", undefined, 16000)).toBe(16000);
    expect(maxTokensFor("some-unknown-model", 128000, 16000)).toBe(64000);
  });

  describe("outputBudget (OpenAI-compatible providers)", () => {
    const opts = (maxTokens: number | undefined, promptChars = 300) => ({
      model: "m",
      system: "s".repeat(promptChars),
      messages: [{ role: "user" as const, content: "hi" }],
      maxTokens,
    });

    it("clamps to the model's output ceiling", () => {
      expect(outputBudget(opts(64000), { maxCompletionTokens: 32000, contextLength: null })).toBe(32000);
    });

    it("leaves room for the prompt inside the context window", () => {
      // 30,000 chars ≈ 10,000 tokens of prompt in a 32k window, less the margin.
      expect(outputBudget(opts(64000, 30000), { maxCompletionTokens: 32000, contextLength: 32768 })).toBe(
        32768 - Math.ceil(30002 / 3) - 1024
      );
    });

    it("sends no limit rather than guessing a large one for a model it knows nothing about", () => {
      expect(outputBudget(opts(64000), null)).toBeUndefined();
      expect(outputBudget(opts(3000), null)).toBe(3000);
      expect(outputBudget(opts(undefined), null)).toBe(4096);
    });
  });
});
