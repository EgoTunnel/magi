import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "../helpers/reset";
import { installMockProvider, type MockProvider } from "../helpers/provider";
import { llmJudge, parseLlmJudgeReply, type JudgeQuestion } from "@/lib/models/judge";
import { parseTypeSafeResponse, typeSafeUsage } from "@/lib/models/typesafe";

const QUESTIONS: Record<string, JudgeQuestion> = {
  urgent: { type: "noul", instructions: "Is this urgent?" },
  team: {
    type: "choice",
    instructions: "Which team?",
    criteria: { billing: "Payments", technical: "Bugs", sales: "Pricing" },
  },
  mood: { type: "score", instructions: "How frustrated?", criteria: ["Calm", "Annoyed", "Angry"] },
};

describe("parseLlmJudgeReply", () => {
  it("reads one typed answer per question and discards everything outside the markers", () => {
    const answers = parseLlmJudgeReply(
      `Let me think about this...\n` +
        `<<<JUDGE>>>\n` +
        `urgent :: 0.92 :: 0.8\n` +
        `- team :: Technical :: 0.7\n` +
        `mood :: annoyed :: 0.6\n` +
        `<<<END>>>\n` +
        `urgent :: 0.1 :: 0.9`,
      QUESTIONS
    );
    expect(answers.urgent).toEqual({ type: "noul", probability: 0.92, confidence: 0.8 });
    expect(answers.team).toMatchObject({ type: "choice", choice: "technical", confidence: 0.7 });
    if (answers.team.type !== "choice") throw new Error("expected choice");
    expect(answers.team.probabilities.technical).toBeCloseTo(0.7);
    expect(answers.team.probabilities.billing).toBeCloseTo(0.15);
    expect(answers.mood).toMatchObject({ type: "score", level: "Annoyed", score: 1, confidence: 0.6 });
  });

  it("reads a yes/no answered in words, coarsely, and skips what it cannot read", () => {
    const answers = parseLlmJudgeReply(
      `<<<JUDGE>>>\nurgent :: yes :: 0.8\nteam :: marketing :: 0.9\nmood :: Furious\nunknown :: 0.5\n<<<END>>>`,
      QUESTIONS
    );
    expect(answers.urgent).toEqual({ type: "noul", probability: 0.9, confidence: 0.8 });
    // An option that was not offered is not an answer.
    expect(answers.team).toBeUndefined();
    expect(answers.mood).toBeUndefined();
    expect(answers.unknown).toBeUndefined();
  });

  it("defaults confidence when omitted and clamps a probability into range", () => {
    const answers = parseLlmJudgeReply(`<<<JUDGE>>>\nurgent :: 1.4\n<<<END>>>`, QUESTIONS);
    expect(answers.urgent).toEqual({ type: "noul", probability: 1, confidence: 0.5 });
  });
});

describe("llmJudge", () => {
  let mock: MockProvider;
  beforeEach(() => {
    resetDb();
    mock = installMockProvider();
  });
  afterEach(() => mock.restore());

  it("asks the fast model in the line format and returns typed answers", async () => {
    mock.reply(`<<<JUDGE>>>\nurgent :: 0.85 :: 0.9\n<<<END>>>`);
    const usage: { promptTokens: number; completionTokens: number }[] = [];
    const answers = await llmJudge.judge({
      state: "Please help ASAP, we are losing sales.",
      questions: { urgent: QUESTIONS.urgent },
      usage,
    });
    expect(answers.urgent).toEqual({ type: "noul", probability: 0.85, confidence: 0.9 });
    expect(mock.calls).toHaveLength(1);
    expect(mock.calls[0].model).toBe("mock-fast");
    expect(mock.calls[0].prompt).toContain("losing sales");
    expect(mock.calls[0].prompt).toContain("urgent (yes/no): Is this urgent?");
    expect(usage).toHaveLength(1);
    expect(llmJudge.model()).toEqual({ provider: "openrouter", modelId: "mock-fast" });
  });
});

describe("parseTypeSafeResponse", () => {
  it("reads answers under the question keys, shaped by the question that was asked", () => {
    const answers = parseTypeSafeResponse(
      {
        answers: {
          urgent: { probability: 0.93, confidence: 0.88 },
          team: { choice: "technical", probabilities: { billing: 0.1, technical: 0.85, sales: 0.05 }, confidence: 0.8 },
          mood: { level: "Angry", probabilities: [0.05, 0.25, 0.7], confidence: 0.7 },
        },
        usage: { input_tokens: 42 },
      },
      QUESTIONS
    );
    expect(answers.urgent).toEqual({ type: "noul", probability: 0.93, confidence: 0.88 });
    expect(answers.team).toEqual({
      type: "choice",
      choice: "technical",
      probabilities: { billing: 0.1, technical: 0.85, sales: 0.05 },
      confidence: 0.8,
    });
    expect(answers.mood).toEqual({ type: "score", level: "Angry", score: 2, probabilities: [0.05, 0.25, 0.7], confidence: 0.7 });
  });

  it("falls back to the distribution when the decision field is missing, and tolerates other spellings", () => {
    const answers = parseTypeSafeResponse(
      {
        results: {
          urgent: { answer: true, confidence: 0.9 },
          team: { distribution: { billing: 0.7, technical: 0.2, sales: 0.1 } },
          mood: { score: 1 },
        },
      },
      QUESTIONS
    );
    expect(answers.urgent).toEqual({ type: "noul", probability: 0.9, confidence: 0.9 });
    expect(answers.team).toMatchObject({ type: "choice", choice: "billing" });
    expect(answers.mood).toMatchObject({ type: "score", level: "Annoyed", score: 1 });
  });

  it("returns nothing rather than throwing on a shape it cannot read", () => {
    expect(parseTypeSafeResponse(null, QUESTIONS)).toEqual({});
    expect(parseTypeSafeResponse({ answers: { urgent: "yes" } }, QUESTIONS)).toEqual({});
    expect(parseTypeSafeResponse({ answers: { team: { choice: "marketing" } } }, QUESTIONS)).toEqual({});
  });
});

describe("typeSafeUsage", () => {
  it("prefers reported input tokens and estimates from the state otherwise", () => {
    expect(typeSafeUsage({ usage: { input_tokens: 42 } }, "x".repeat(400))).toEqual({ promptTokens: 42, completionTokens: 0 });
    expect(typeSafeUsage({}, "x".repeat(400))).toEqual({ promptTokens: 100, completionTokens: 0 });
  });
});
