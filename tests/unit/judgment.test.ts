import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDb } from "../helpers/reset";
import { installMockProvider, type MockProvider } from "../helpers/provider";
import { setSetting } from "@/lib/settings";
import { judge, JudgmentError, readAnswers, type ChoiceQuestion, type ScoreQuestion } from "@/lib/models/judgment";
import { classifyModelRole } from "@/lib/models/registry";
import { estimateCost } from "@/lib/models/pricing";

const department: ChoiceQuestion = {
  type: "choice",
  instructions: "Which team should handle this?",
  criteria: { billing: "Payments", technical: "Bugs", sales: "Pricing" },
};
const frustration: ScoreQuestion = {
  type: "score",
  instructions: "How frustrated is the customer?",
  criteria: ["Calm", "Mildly annoyed", "Frustrated", "Very angry"],
};

describe("readAnswers", () => {
  it("reads a choice, its distribution, and its confidence", () => {
    const answers = readAnswers(
      { answers: { d: { choice: "technical", probabilities: { technical: 0.8, billing: 0.15, sales: 0.05 }, confidence: 0.8 } } },
      { d: department }
    );
    expect(answers.d).toEqual({
      choice: "technical",
      probabilities: { technical: 0.8, billing: 0.15, sales: 0.05 },
      confidence: 0.8,
    });
  });

  // The whole point of a typed decision: an answer that isn't one of the
  // options must never be acted on, however it got there.
  it("refuses a choice that isn't one of the offered options", () => {
    expect(() => readAnswers({ answers: { d: { choice: "legal", confidence: 0.9 } } }, { d: department })).toThrow(
      JudgmentError
    );
  });

  it("takes the most probable option when only a distribution comes back", () => {
    const answers = readAnswers(
      { answers: { d: { distribution: [{ option: "sales", probability: 0.7 }, { option: "billing", probability: 0.3 }] } } },
      { d: department }
    );
    expect(answers.d.choice).toBe("sales");
    expect(answers.d.confidence).toBe(0.7);
  });

  it("reads a yes/no probability given bare or wrapped", () => {
    const noul = { type: "noul" as const, instructions: "Is this urgent?" };
    expect(readAnswers({ answers: { u: 0.9 } }, { u: noul }).u).toEqual({ probability: 0.9, confidence: 0.9 });
    expect(readAnswers({ answers: { u: { probability: 0.2, confidence: 0.7 } } }, { u: noul }).u).toEqual({
      probability: 0.2,
      confidence: 0.7,
    });
    expect(() => readAnswers({ answers: { u: 1.4 } }, { u: noul })).toThrow(JudgmentError);
  });

  it("reads a score given as a label or as a position on the scale", () => {
    expect(readAnswers({ answers: { f: { score: "Frustrated", confidence: 0.6 } } }, { f: frustration }).f).toMatchObject({
      score: "Frustrated",
      level: 2,
    });
    expect(readAnswers({ answers: { f: { level: 3 } } }, { f: frustration }).f).toMatchObject({
      score: "Very angry",
      level: 3,
    });
    expect(() => readAnswers({ answers: { f: { level: 7 } } }, { f: frustration })).toThrow(JudgmentError);
  });

  it("refuses a response missing an answer it was asked for", () => {
    expect(() => readAnswers({ answers: {} }, { d: department })).toThrow(JudgmentError);
    expect(() => readAnswers({}, { d: department })).toThrow(JudgmentError);
  });
});

describe("judge", () => {
  beforeEach(resetDb);
  afterEach(() => vi.unstubAllGlobals());

  it("won't call out without a key", async () => {
    await expect(judge({ state: "x", questions: { d: department } })).rejects.toThrow(/No TypeSafe API key/);
  });

  it("sends the state and typed questions, and records input tokens", async () => {
    setSetting("typesafe_api_key", "ts-test");
    const fetchMock = vi.fn(async () =>
      Response.json({ answers: { d: { choice: "billing", confidence: 0.91 } }, usage: { input_tokens: 42 } })
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await judge({ state: "My card was charged twice", questions: { d: department } });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.typesafe.ai/v1/systemone");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer ts-test");
    expect(JSON.parse(init.body as string)).toEqual({
      model: "jev-latest",
      state: "My card was charged twice",
      questions: { d: department },
    });
    expect(result.answers.d.choice).toBe("billing");
    expect(result.usage).toEqual([{ promptTokens: 42, completionTokens: 0 }]);
  });

  it("turns an HTTP error into a JudgmentError carrying the reason", async () => {
    setSetting("typesafe_api_key", "ts-test");
    vi.stubGlobal("fetch", async () => Response.json({ error: { message: "invalid key" } }, { status: 401 }));
    await expect(judge({ state: "x", questions: { d: department } })).rejects.toThrow("HTTP 401: invalid key");
  });

  it("is priced on input tokens only", () => {
    expect(estimateCost("typesafe", "jev-latest", { promptTokens: 1_000_000, completionTokens: 0 })).toBeCloseTo(0.042, 6);
  });
});

describe("Auto role classification", () => {
  let mock: MockProvider;
  beforeEach(() => {
    resetDb();
    mock = installMockProvider();
  });
  afterEach(() => {
    mock.restore();
    vi.unstubAllGlobals();
  });

  const jevAnswers = (choice: string, confidence: number) =>
    vi.fn(async () => Response.json({ answers: { role: { choice, confidence } }, usage: { input_tokens: 30 } }));

  it("uses Jev when a key is set, and never calls the chat model", async () => {
    setSetting("typesafe_api_key", "ts-test");
    vi.stubGlobal("fetch", jevAnswers("reasoner", 0.86));
    const callsBefore = mock.calls.length;

    const result = await classifyModelRole("Prove there are infinitely many primes");
    expect(result).toMatchObject({ role: "reasoner", decidedBy: "jev", confidence: 0.86, providerId: "typesafe" });
    expect(mock.calls.length).toBe(callsBefore);
  });

  it("keeps Default when Jev isn't confident", async () => {
    setSetting("typesafe_api_key", "ts-test");
    vi.stubGlobal("fetch", jevAnswers("writer", 0.34));
    expect(await classifyModelRole("hmm")).toMatchObject({ role: "default", decidedBy: "jev", confidence: 0.34 });
  });

  it("falls back to the chat model when Jev fails", async () => {
    setSetting("typesafe_api_key", "ts-test");
    vi.stubGlobal("fetch", async () => new Response("upstream down", { status: 503 }));
    vi.spyOn(console, "error").mockImplementation(() => {});
    mock.reply("critic");

    expect(await classifyModelRole("Tear this plan apart")).toMatchObject({ role: "critic", decidedBy: "model" });
  });

  it("uses the chat model, as before, when no key is set", async () => {
    mock.reply("writer");
    expect(await classifyModelRole("Draft an intro paragraph")).toMatchObject({ role: "writer", decidedBy: "model" });
  });
});
