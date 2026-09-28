import { getModel, modelForRole, reasoningEffortForRole } from "@/lib/models/registry";
import type { TokenUsage } from "@/lib/models/types";
import { typeSafeJudge } from "@/lib/models/typesafe";
import type { UsageProvider } from "@/lib/repo/usage";

// A judge is not a model provider. Everything in src/lib/models/ so far
// *generates* — it takes a prompt and returns prose, and the rest of Magi
// parses decisions out of that prose with delimiters and regexes. A judge
// answers typed questions about a piece of content and returns typed values:
// a probability, a choice, a level. It never writes a sentence.
//
// The split matters because the two have different failure modes. A generator
// can drift, narrate, or run out of budget mid-answer; a judge can only be
// wrong *within* the schema it was given. Decision points in Magi — is this
// relevant, was this answered, which role fits — want the second kind.
//
// Two implementations: TypeSafe's Jev (typesafe.ts), a model built for exactly
// this, and a fallback that asks the `fast` role model to answer in a fixed
// line format. The fallback is what keeps this abstraction honest: nothing
// that uses a judge depends on one vendor existing, and the tests run the
// same code paths against a mock.

export type JudgeQuestion =
  // A yes/no statement; the answer is the probability it is true.
  | { type: "noul"; instructions: string }
  // One of a fixed set of options, each with a description.
  | { type: "choice"; instructions: string; criteria: Record<string, string> }
  // One of an ordered list of levels.
  | { type: "score"; instructions: string; criteria: string[] };

export type JudgeAnswer =
  | { type: "noul"; probability: number; confidence: number }
  | { type: "choice"; choice: string; probabilities: Record<string, number>; confidence: number }
  | { type: "score"; level: string; score: number; probabilities: number[]; confidence: number };

export interface JudgeOptions {
  // What is being judged. Kept focused on purpose — a judge is asked about
  // one exchange or one passage, never handed a whole conversation.
  state: string;
  questions: Record<string, JudgeQuestion>;
  // Out-param, same convention as CompleteOptions.usage.
  usage?: TokenUsage[];
}

export interface JudgeProvider {
  id: "typesafe" | "llm";
  label: string;
  // Who actually gets billed for a call, for the usage ledger — the fallback
  // judge answers through whichever provider the `fast` role is assigned to.
  model(): { provider: UsageProvider; modelId: string };
  isConfigured(): boolean;
  judge(opts: JudgeOptions): Promise<Record<string, JudgeAnswer>>;
}

// ---------------------------------------------------------------------------
// The fallback: a generative model constrained to one line per question. Uses
// the `fast` role, and the same delimiter convention as episodeClose.ts, for
// the same reason — anything outside the markers is reasoning to discard.
// ---------------------------------------------------------------------------

const OUTPUT_START = "<<<JUDGE>>>";
const OUTPUT_END = "<<<END>>>";

const LLM_JUDGE_SYSTEM_PROMPT =
  "You are a judge. You will be shown a piece of content and a list of typed questions about it. " +
  "Answer every question with exactly one line, in this exact form:\n\n" +
  "<question id> :: <answer> :: <confidence>\n\n" +
  "Where <answer> is:\n" +
  "- for a yes/no question: a number between 0 and 1, the probability the statement is true of the content;\n" +
  "- for a choice question: exactly one of the option ids listed for it;\n" +
  "- for a score question: exactly one of the levels listed for it, verbatim.\n" +
  "And <confidence> is a number between 0 and 1 for how sure you are of that answer.\n\n" +
  "Judge only what the content actually says. Be literal. Do not infer intent that is not on the page.\n\n" +
  `Put all of your lines between a line containing exactly ${OUTPUT_START} and a line containing exactly ` +
  `${OUTPUT_END}. Anything outside those markers is discarded, so do all of your thinking before the ` +
  "opening marker. Inside the markers write nothing but answer lines: no commentary, no headings.";

function describeQuestions(questions: Record<string, JudgeQuestion>): string {
  return Object.entries(questions)
    .map(([key, q]) => {
      if (q.type === "noul") return `${key} (yes/no): ${q.instructions}`;
      if (q.type === "choice") {
        const options = Object.entries(q.criteria)
          .map(([id, desc]) => `${id} — ${desc}`)
          .join("; ");
        return `${key} (choice; options: ${options}): ${q.instructions}`;
      }
      return `${key} (score; levels in order: ${q.criteria.join(" < ")}): ${q.instructions}`;
    })
    .join("\n");
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

// Deliberately permissive, like parseCuration: a leading bullet, extra
// whitespace, or a missing confidence must not throw away a usable answer.
const LINE = /^\s*(?:[-*]\s*)?(\S+?)\s*::\s*(.+?)(?:\s*::\s*([\d.]+))?\s*$/;

export function parseLlmJudgeReply(
  raw: string,
  questions: Record<string, JudgeQuestion>
): Record<string, JudgeAnswer> {
  const start = raw.indexOf(OUTPUT_START);
  const end = raw.indexOf(OUTPUT_END, start === -1 ? 0 : start);
  const body = start === -1 || end === -1 ? raw : raw.slice(start + OUTPUT_START.length, end);

  const out: Record<string, JudgeAnswer> = {};
  for (const line of body.split("\n")) {
    const m = LINE.exec(line);
    if (!m) continue;
    const key = m[1];
    const question = questions[key];
    if (!question || out[key]) continue;
    const answer = m[2].trim();
    const confidence = m[3] !== undefined && Number.isFinite(Number(m[3])) ? clamp01(Number(m[3])) : 0.5;

    if (question.type === "noul") {
      const n = Number(answer);
      let probability: number | null = Number.isFinite(n) ? clamp01(n) : null;
      // A model that answers the question rather than the format still gets
      // read, coarsely — the confidence it reported is the best information
      // about how far from 0.5 to place it.
      if (probability === null && /^yes\b/i.test(answer)) probability = 0.5 + confidence / 2;
      if (probability === null && /^no\b/i.test(answer)) probability = 0.5 - confidence / 2;
      if (probability === null) continue;
      out[key] = { type: "noul", probability, confidence };
      continue;
    }

    if (question.type === "choice") {
      const ids = Object.keys(question.criteria);
      const choice = ids.find((id) => id.toLowerCase() === answer.toLowerCase());
      if (!choice) continue;
      // The model gave one answer, not a distribution: its confidence goes to
      // the choice and the remainder is spread evenly, which is the least
      // presumptuous distribution consistent with what it said.
      const rest = ids.length > 1 ? (1 - confidence) / (ids.length - 1) : 0;
      const probabilities = Object.fromEntries(ids.map((id) => [id, id === choice ? confidence : rest]));
      out[key] = { type: "choice", choice, probabilities, confidence };
      continue;
    }

    const levels = question.criteria;
    const index = levels.findIndex((l) => l.toLowerCase() === answer.toLowerCase());
    if (index === -1) continue;
    const rest = levels.length > 1 ? (1 - confidence) / (levels.length - 1) : 0;
    out[key] = {
      type: "score",
      level: levels[index],
      score: index,
      probabilities: levels.map((_, i) => (i === index ? confidence : rest)),
      confidence,
    };
  }
  return out;
}

export const llmJudge: JudgeProvider = {
  id: "llm",
  label: "Assigned fast model",
  model: () => {
    const modelId = modelForRole("fast");
    const provider = (getModel(modelId)?.provider.id ?? "openrouter") as UsageProvider;
    return { provider, modelId };
  },
  isConfigured: () => {
    const resolved = getModel(modelForRole("fast"));
    return !!resolved && resolved.provider.isConfigured();
  },
  async judge(opts) {
    const modelId = modelForRole("fast");
    const resolved = getModel(modelId);
    if (!resolved || !resolved.provider.isConfigured()) throw new Error("NO_API_KEY");
    const raw = await resolved.provider.complete({
      model: modelId,
      system: LLM_JUDGE_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Content:\n---\n${opts.state}\n---\n\nQuestions:\n${describeQuestions(opts.questions)}`,
        },
      ],
      // Generous for the same reason classifyModelRole's is: a mandatory-
      // reasoning model spends an unknowable share of this before the first
      // answer line, and a starved budget is a silent empty answer.
      maxTokens: 2000,
      reasoningEffort: reasoningEffortForRole("fast"),
      usage: opts.usage,
    });
    return parseLlmJudgeReply(raw, opts.questions);
  },
};

// ---------------------------------------------------------------------------
// Selection. Jev when a TypeSafe key is configured, otherwise the fallback —
// adding the key *is* the opt-in to sending judged content to a new vendor,
// which is why there is no separate switch: without the key, nothing leaves
// the machine that wasn't already going to the assigned chat provider.
// ---------------------------------------------------------------------------

const DEFAULT_JUDGES: JudgeProvider[] = [typeSafeJudge, llmJudge];
let JUDGES: JudgeProvider[] = DEFAULT_JUDGES;

// Test seam, same shape as __setProvidersForTests in registry.ts.
export function __setJudgesForTests(judges: JudgeProvider[]): () => void {
  const previous = JUDGES;
  JUDGES = judges;
  return () => {
    JUDGES = previous;
  };
}

export function getJudge(): JudgeProvider | null {
  return JUDGES.find((j) => j.isConfigured()) ?? null;
}

export function listJudges(): Array<{ id: JudgeProvider["id"]; label: string; configured: boolean }> {
  return JUDGES.map((j) => ({ id: j.id, label: j.label, configured: j.isConfigured() }));
}
