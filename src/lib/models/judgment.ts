// Judgment: fast, typed decisions from a "System One" model — TypeSafe AI's
// Jev — as opposed to the chat providers beside this file, which generate
// text. A judgment call takes some state (text) and one or more typed
// questions, and returns one typed answer per question: a probability, a pick
// from a fixed set, or a level on a fixed scale, each with a confidence.
//
// This is for the places Magi used to make a chat model answer a
// multiple-choice question and then fish the answer out of its prose (the
// Auto role classifier being the first). It is opt-in — nothing here runs
// without a TypeSafe key — and every caller keeps its chat-model path as the
// fallback, so a missing key, a timeout, or an answer that doesn't fit the
// question all degrade to exactly how Magi behaved before.
//
// The response is validated against the question, not trusted: a choice must
// be one of the offered options and a probability must be a probability.
// Anything else is a JudgmentError — the caller falls back rather than acting
// on a decision it can't be sure it read correctly.
import { getSetting } from "@/lib/settings";
import type { TokenUsage } from "@/lib/models/types";

export const JUDGMENT_PROVIDER = "typesafe" as const;
const ENDPOINT = "https://api.typesafe.ai/v1/systemone";
const DEFAULT_MODEL = "jev-latest";
// Jev's answers take 70–500ms. Anything past this is a stalled request, and
// every caller has a fallback worth more than waiting.
const TIMEOUT_MS = 4000;

export function getTypeSafeApiKey(): string | null {
  return getSetting("typesafe_api_key") || process.env.TYPESAFE_API_KEY || null;
}

export function judgmentModelId(): string {
  return getSetting("typesafe_model") || DEFAULT_MODEL;
}

export function isJudgmentConfigured(): boolean {
  return !!getTypeSafeApiKey();
}

// ---------------------------------------------------------------------------
// Questions and answers
// ---------------------------------------------------------------------------

// Yes/no: the probability that the statement in `instructions` is true.
export interface NoulQuestion {
  type: "noul";
  instructions: string;
}
// One of a fixed set of options, each id described.
export interface ChoiceQuestion {
  type: "choice";
  instructions: string;
  criteria: Record<string, string>;
}
// A level on an ordered scale, lowest first.
export interface ScoreQuestion {
  type: "score";
  instructions: string;
  criteria: string[];
}
export type JudgmentQuestion = NoulQuestion | ChoiceQuestion | ScoreQuestion;

export interface NoulAnswer {
  probability: number;
  confidence: number;
}
export interface ChoiceAnswer {
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
}
export interface ScoreAnswer {
  // The level's label, and its position on the scale (0 = first).
  score: string;
  level: number;
  probabilities: Record<string, number>;
  confidence: number;
}

export type AnswerFor<Q extends JudgmentQuestion> = Q extends NoulQuestion
  ? NoulAnswer
  : Q extends ChoiceQuestion
    ? ChoiceAnswer
    : ScoreAnswer;

export type Answers<Qs extends Record<string, JudgmentQuestion>> = { [K in keyof Qs]: AnswerFor<Qs[K]> };

export class JudgmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JudgmentError";
  }
}

// ---------------------------------------------------------------------------
// Reading a response
//
// Written against TypeSafe's early-access API as described at launch: answers
// keyed by question name, each carrying the decision, a distribution, and a
// confidence. The field names below accept the plausible spellings of each
// rather than one guess, because a wrong guess here must fail closed (a
// JudgmentError, and the caller's fallback), never mis-read a decision. If the
// API's shape changes, this block is the only thing that needs to.
// ---------------------------------------------------------------------------

const isProbability = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;

function field(obj: Record<string, unknown>, names: string[]): unknown {
  for (const name of names) if (obj[name] !== undefined) return obj[name];
  return undefined;
}

function distribution(raw: unknown, allowed: string[]): Record<string, number> | null {
  if (!raw || typeof raw !== "object") return null;
  // Either { option: p } or [{ option|label|value, probability|p }]
  const entries: Array<[string, unknown]> = Array.isArray(raw)
    ? raw.map((e) => {
        const o = (e ?? {}) as Record<string, unknown>;
        return [String(field(o, ["option", "label", "value", "choice", "name"])), field(o, ["probability", "p", "prob"])];
      })
    : Object.entries(raw as Record<string, unknown>);
  const out: Record<string, number> = {};
  for (const [key, p] of entries) {
    if (allowed.includes(key) && isProbability(p)) out[key] = p;
  }
  return Object.keys(out).length ? out : null;
}

function readNoul(raw: unknown): NoulAnswer {
  if (isProbability(raw)) return { probability: raw, confidence: Math.max(raw, 1 - raw) };
  if (!raw || typeof raw !== "object") throw new JudgmentError("noul answer is not an object");
  const o = raw as Record<string, unknown>;
  const probability = field(o, ["probability", "p", "prob", "value", "true"]);
  if (!isProbability(probability)) throw new JudgmentError("noul answer has no probability");
  const confidence = field(o, ["confidence"]);
  return {
    probability,
    confidence: isProbability(confidence) ? confidence : Math.max(probability, 1 - probability),
  };
}

function readChoice(raw: unknown, q: ChoiceQuestion): ChoiceAnswer {
  const options = Object.keys(q.criteria);
  const o = (raw && typeof raw === "object" ? raw : { choice: raw }) as Record<string, unknown>;
  const probabilities = distribution(field(o, ["probabilities", "distribution", "probs", "scores"]), options) ?? {};
  let choice = field(o, ["choice", "answer", "decision", "value", "option", "label"]);
  if (choice === undefined && Object.keys(probabilities).length) {
    choice = Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0][0];
  }
  if (typeof choice !== "string" || !options.includes(choice)) {
    throw new JudgmentError(`choice answer is not one of the offered options`);
  }
  const confidence = field(o, ["confidence"]);
  return {
    choice,
    probabilities,
    confidence: isProbability(confidence) ? confidence : (probabilities[choice] ?? 0),
  };
}

function readScore(raw: unknown, q: ScoreQuestion): ScoreAnswer {
  const levels = q.criteria;
  const o = (raw && typeof raw === "object" ? raw : { score: raw }) as Record<string, unknown>;
  const probabilities = distribution(field(o, ["probabilities", "distribution", "probs", "scores"]), levels) ?? {};
  let value = field(o, ["score", "level", "answer", "value", "choice", "label"]);
  if (value === undefined && Object.keys(probabilities).length) {
    value = Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0][0];
  }
  // A level may come back as its label or as its position on the scale.
  const level =
    typeof value === "string" ? levels.indexOf(value) : Number.isInteger(value) ? (value as number) : -1;
  if (level < 0 || level >= levels.length) throw new JudgmentError("score answer is not one of the offered levels");
  const confidence = field(o, ["confidence"]);
  return {
    score: levels[level],
    level,
    probabilities,
    confidence: isProbability(confidence) ? confidence : (probabilities[levels[level]] ?? 0),
  };
}

export function readAnswers<Qs extends Record<string, JudgmentQuestion>>(body: unknown, questions: Qs): Answers<Qs> {
  const root = (body ?? {}) as Record<string, unknown>;
  const answers = field(root, ["answers", "results", "outputs"]);
  if (!answers || typeof answers !== "object") throw new JudgmentError("response has no answers");
  const out = {} as Record<string, unknown>;
  for (const [key, q] of Object.entries(questions)) {
    const raw = (answers as Record<string, unknown>)[key];
    if (raw === undefined) throw new JudgmentError(`response has no answer for "${key}"`);
    out[key] = q.type === "noul" ? readNoul(raw) : q.type === "choice" ? readChoice(raw, q) : readScore(raw, q);
  }
  return out as Answers<Qs>;
}

// Input tokens as the API reports them, or an estimate (≈4 characters a token)
// when it doesn't — so every call still shows up in Usage & cost.
function readUsage(body: unknown, requestChars: number): TokenUsage {
  const usage = ((body ?? {}) as Record<string, unknown>).usage as Record<string, unknown> | undefined;
  const reported = usage ? field(usage, ["input_tokens", "prompt_tokens", "inputTokens", "total_tokens"]) : undefined;
  const promptTokens = typeof reported === "number" && reported >= 0 ? reported : Math.ceil(requestChars / 4);
  return { promptTokens, completionTokens: 0 };
}

// ---------------------------------------------------------------------------
// The call
// ---------------------------------------------------------------------------

export interface JudgmentResult<Qs extends Record<string, JudgmentQuestion>> {
  answers: Answers<Qs>;
  usage: TokenUsage[];
  modelId: string;
  latencyMs: number;
}

export async function judge<Qs extends Record<string, JudgmentQuestion>>(opts: {
  // What's being judged. Keep it to what the questions need — irrelevant
  // context makes a System One model worse, not better.
  state: string | Record<string, unknown> | string[];
  questions: Qs;
  signal?: AbortSignal;
}): Promise<JudgmentResult<Qs>> {
  const apiKey = getTypeSafeApiKey();
  if (!apiKey) throw new JudgmentError("No TypeSafe API key configured");
  const modelId = judgmentModelId();
  const payload = JSON.stringify({ model: modelId, state: opts.state, questions: opts.questions });
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;

  const started = Date.now();
  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: payload,
      signal,
    });
  } catch (err) {
    throw new JudgmentError(`request failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = (body as { error?: { message?: string } | string } | null)?.error;
    const message = typeof detail === "string" ? detail : detail?.message;
    throw new JudgmentError(`HTTP ${res.status}${message ? `: ${message}` : ""}`);
  }
  return {
    answers: readAnswers(body, opts.questions),
    usage: [readUsage(body, payload.length)],
    modelId,
    latencyMs: Date.now() - started,
  };
}
