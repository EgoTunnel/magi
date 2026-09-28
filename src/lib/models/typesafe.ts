import { getTypeSafeApiKey } from "@/lib/settings";
// Type-only: judge.ts imports this module's value at runtime, so a value
// import back would be a real cycle. Types are erased, this is not.
import type { JudgeAnswer, JudgeOptions, JudgeProvider, JudgeQuestion } from "@/lib/models/judge";

// TypeSafe AI's Jev, a "System One" model: it takes a state and a set of typed
// questions and returns typed answers — probabilities, choices, levels — in
// one parallel pass, with no free text anywhere in the exchange. It cannot
// answer outside the schema it was given, which is what makes it the right
// instrument for the decision points in Magi (see judge.ts).
//
// The request shape below follows the launch documentation. The *response*
// shape is read defensively — field names are matched by a short list of
// plausible spellings, and anything unreadable is simply absent from the
// result rather than an error — because a judge that throws on a renamed
// field would take the Standing watch down with it. If a real response ever
// comes back empty against a known-good request, docs.typesafe.ai is where to
// check the field names.

const ENDPOINT = "https://api.typesafe.ai/v1/systemone";
export const TYPESAFE_MODEL_ID = "jev-latest";
// Launch pricing: $0.042 per million input tokens, output free. There is no
// live catalog to read it from, so this is the one number in the cost ledger
// that has to be maintained by hand.
export const TYPESAFE_PROMPT_PRICE_PER_M = 0.042;

function toWireQuestion(q: JudgeQuestion) {
  if (q.type === "noul") return { type: "noul", instructions: q.instructions };
  if (q.type === "choice") return { type: "choice", instructions: q.instructions, criteria: q.criteria };
  return { type: "score", instructions: q.instructions, criteria: q.criteria };
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function firstNumber(obj: Record<string, unknown>, keys: string[]): number | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return null;
}

function firstString(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v) return v;
  }
  return null;
}

function firstValue(obj: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) if (obj[k] !== undefined) return obj[k];
  return undefined;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

// Reads one answer against the question it was asked for. The question is the
// authority on shape: a "noul" question yields a noul answer or nothing, so a
// caller can branch on the answer type it asked for without re-checking.
function readAnswer(question: JudgeQuestion, raw: unknown): JudgeAnswer | null {
  if (!isRecord(raw)) return null;
  const confidence = clamp01(firstNumber(raw, ["confidence"]) ?? 0.5);

  if (question.type === "noul") {
    let probability = firstNumber(raw, ["probability", "p", "value", "answer", "decision"]);
    if (probability === null) {
      const v = firstValue(raw, ["answer", "decision", "value"]);
      if (typeof v === "boolean") probability = v ? confidence : 1 - confidence;
    }
    if (probability === null) return null;
    return { type: "noul", probability: clamp01(probability), confidence };
  }

  if (question.type === "choice") {
    const ids = Object.keys(question.criteria);
    const dist = firstValue(raw, ["probabilities", "distribution"]);
    const probabilities: Record<string, number> = {};
    if (isRecord(dist)) {
      for (const id of ids) {
        const v = dist[id];
        if (typeof v === "number" && Number.isFinite(v)) probabilities[id] = clamp01(v);
      }
    }
    let choice = firstString(raw, ["choice", "answer", "decision", "value"]);
    if (choice && !ids.includes(choice)) choice = ids.find((id) => id.toLowerCase() === choice!.toLowerCase()) ?? null;
    if (!choice && Object.keys(probabilities).length) {
      choice = Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0][0];
    }
    if (!choice) return null;
    return { type: "choice", choice, probabilities, confidence };
  }

  const levels = question.criteria;
  const dist = firstValue(raw, ["probabilities", "distribution"]);
  const probabilities = Array.isArray(dist)
    ? dist.map((v) => (typeof v === "number" && Number.isFinite(v) ? clamp01(v) : 0))
    : [];
  let index: number | null = null;
  const level = firstString(raw, ["level", "answer", "choice", "decision", "value"]);
  if (level) {
    const i = levels.findIndex((l) => l.toLowerCase() === level.toLowerCase());
    if (i !== -1) index = i;
  }
  if (index === null) {
    const score = firstNumber(raw, ["score", "index"]);
    if (score !== null && Number.isInteger(score) && score >= 0 && score < levels.length) index = score;
  }
  if (index === null && probabilities.length === levels.length) {
    index = probabilities.indexOf(Math.max(...probabilities));
  }
  if (index === null) return null;
  return { type: "score", level: levels[index], score: index, probabilities, confidence };
}

export function parseTypeSafeResponse(
  json: unknown,
  questions: Record<string, JudgeQuestion>
): Record<string, JudgeAnswer> {
  const out: Record<string, JudgeAnswer> = {};
  if (!isRecord(json)) return out;
  const answers = firstValue(json, ["answers", "results", "questions"]);
  if (!isRecord(answers)) return out;
  for (const [key, question] of Object.entries(questions)) {
    const answer = readAnswer(question, answers[key]);
    if (answer) out[key] = answer;
  }
  return out;
}

// Input tokens as the API reports them, or a character-based estimate when it
// doesn't — an estimate in the ledger beats a call that cost something and
// shows nothing. Output is free, so completion tokens are always 0.
export function typeSafeUsage(json: unknown, state: string): { promptTokens: number; completionTokens: number } {
  if (isRecord(json) && isRecord(json.usage)) {
    const n = firstNumber(json.usage, ["input_tokens", "prompt_tokens", "inputTokens", "promptTokens"]);
    if (n !== null) return { promptTokens: n, completionTokens: 0 };
  }
  return { promptTokens: Math.ceil(state.length / 4), completionTokens: 0 };
}

export const typeSafeJudge: JudgeProvider = {
  id: "typesafe",
  label: "TypeSafe Jev",
  model: () => ({ provider: "typesafe", modelId: TYPESAFE_MODEL_ID }),
  isConfigured: () => !!getTypeSafeApiKey(),
  async judge(opts: JudgeOptions) {
    const apiKey = getTypeSafeApiKey();
    if (!apiKey) throw new Error("NO_API_KEY");
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: TYPESAFE_MODEL_ID,
        state: opts.state,
        questions: Object.fromEntries(Object.entries(opts.questions).map(([k, q]) => [k, toWireQuestion(q)])),
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`TypeSafe ${res.status}: ${detail.slice(0, 200) || res.statusText}`);
    }
    const json: unknown = await res.json();
    opts.usage?.push(typeSafeUsage(json, opts.state));
    return parseTypeSafeResponse(json, opts.questions);
  },
};
