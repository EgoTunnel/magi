// The Council's typed judgments: how much its members actually agree
// (consensus), and — in Decision Matrix mode — how well each option meets each
// criterion. Both are asked of Jev when a TypeSafe key is set (see
// src/lib/models/judgment.ts): a rating on a fixed scale, with a distribution
// and a confidence, rather than a word fished out of a Synthesizer's prose.
//
// The arithmetic stays here, in code — weighting, totals, what the ranking
// turns on. A System One model is for judgment, not sums.
import { getModel, modelForRole, reasoningEffortForRole } from "@/lib/models/registry";
import { isJudgmentConfigured, judge, JUDGMENT_PROVIDER, type ScoreQuestion } from "@/lib/models/judgment";
import type { TokenUsage } from "@/lib/models/types";
import { recordUsage } from "@/lib/repo/usage";
import {
  CONSENSUS_LEVELS,
  MATRIX_LEVELS,
  type ConsensusDetail,
  type ConsensusLevel,
  type CouncilMode,
  type CouncilTranscriptEntry,
  type MatrixCell,
  type MatrixCriterion,
  type MatrixResult,
} from "@/lib/repo/councils";

// Enough of each contribution to judge it by, and no more: irrelevant length
// makes a System One model worse, not better.
const PER_ENTRY_CHARS = 2500;
const STATE_CHARS = 14000;

function recordJudgmentUsage(runId: string, projectId: string | null | undefined, modelId: string, usage: TokenUsage[]) {
  recordUsage({
    projectId,
    source: "council",
    sourceId: runId,
    provider: JUDGMENT_PROVIDER,
    model: modelId,
    role: "judge",
    usage,
  });
}

// ---------------------------------------------------------------------------
// Consensus
// ---------------------------------------------------------------------------

// The Synthesizer is asked for exactly one of the four levels, but may say
// "Moderate — two of three agree". Reads the level, not the sentence.
export function normalizeConsensus(text: string | null | undefined): ConsensusLevel | null {
  if (!text) return null;
  const match = /\b(none|weak|moderate|strong)\b/i.exec(text);
  if (!match) return null;
  const word = match[1].toLowerCase();
  return CONSENSUS_LEVELS.find((l) => l.toLowerCase() === word) ?? null;
}

// What "consensus" means differs by mode, so the question does too.
const CONSENSUS_INSTRUCTIONS: Record<CouncilMode, string> = {
  independent:
    "Across these Council members' analyses and critiques, how strongly do they agree on the answer to the question?",
  matrix: "Across these Council members' assessments, how strongly do they agree about which option is best?",
  debate: "After both sides' openings and rebuttals, how much do they agree on the answer to the question?",
  redTeam:
    "Judging by the attacks and the proposer's defense, how much of the original proposal survived intact?",
};

// Only the members' own words go in — never the Synthesizer's, which would
// hand Jev a summary of the answer instead of the evidence for it.
function consensusState(question: string, transcript: CouncilTranscriptEntry[]) {
  let budget = STATE_CHARS;
  const contributions: Array<{ member: string; stage: string; text: string }> = [];
  for (const entry of transcript) {
    if (entry.stage === "synthesis" || budget <= 0) continue;
    const text = entry.content.slice(0, Math.min(PER_ENTRY_CHARS, budget));
    budget -= text.length;
    contributions.push({ member: entry.role, stage: entry.stage, text });
  }
  return { question, contributions };
}

// Never throws: with no key, or on any failure, the Synthesizer's own rating
// stands, as it always has.
export async function measureConsensus(opts: {
  runId: string;
  projectId?: string | null;
  mode: CouncilMode;
  question: string;
  transcript: CouncilTranscriptEntry[];
  synthesizerSaid: string | null;
}): Promise<ConsensusDetail> {
  const synthesizerSaid = normalizeConsensus(opts.synthesizerSaid);
  const fallback: ConsensusDetail = { source: "synthesizer", level: synthesizerSaid, synthesizerSaid };
  if (!isJudgmentConfigured()) return fallback;
  try {
    const { answers, usage, modelId } = await judge({
      state: consensusState(opts.question, opts.transcript),
      questions: {
        consensus: {
          type: "score",
          instructions: CONSENSUS_INSTRUCTIONS[opts.mode],
          criteria: [...CONSENSUS_LEVELS],
        },
      },
    });
    recordJudgmentUsage(opts.runId, opts.projectId, modelId, usage);
    const { score, confidence, probabilities } = answers.consensus;
    return {
      source: "jev",
      level: score as ConsensusLevel,
      confidence,
      probabilities: probabilities as ConsensusDetail["probabilities"],
      synthesizerSaid,
    };
  } catch (err) {
    console.error("[council] Jev consensus failed; keeping the Synthesizer's", err instanceof Error ? err.message : err);
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// Decision Matrix — reading the assessments
// ---------------------------------------------------------------------------

// Members are asked to give each option its own heading. This finds each
// option's section in one member's assessment, so the option is judged on
// what was said about it — and falls back to the whole assessment when a
// member didn't follow the structure, rather than judging on nothing.
export function sectionsByOption(text: string, options: string[]): Record<string, string> {
  const headings = options.map((option) => {
    const escaped = option.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`^\\s{0,3}#{1,6}\\s*(?:option\\s*\\d*\\s*[:.-]?\\s*)?\\**${escaped}\\**\\s*$`, "im");
    const m = re.exec(text);
    return { option, start: m ? m.index : -1, bodyStart: m ? m.index + m[0].length : -1 };
  });
  const found = headings.filter((h) => h.start >= 0).sort((a, b) => a.start - b.start);
  const out: Record<string, string> = {};
  for (const h of headings) {
    if (h.start < 0) {
      out[h.option] = text;
      continue;
    }
    const next = found.find((f) => f.start > h.start);
    out[h.option] = text.slice(h.bodyStart, next ? next.start : undefined).trim() || text;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Decision Matrix — the arithmetic
// ---------------------------------------------------------------------------

// A level averaged over its distribution, on 0-10. A "Good" Jev was only 55%
// sure of, with the rest on "Fair", counts for less than a certain "Good".
export function expectedScore(level: number, probabilities?: Record<string, number>): number {
  const top = MATRIX_LEVELS.length - 1;
  if (probabilities) {
    let mass = 0;
    let sum = 0;
    MATRIX_LEVELS.forEach((label, i) => {
      const p = probabilities[label];
      if (typeof p === "number" && p > 0) {
        mass += p;
        sum += p * i;
      }
    });
    if (mass > 0) return (sum / mass / top) * 10;
  }
  return (level / top) * 10;
}

function weightedTotals(options: string[], criteria: MatrixCriterion[], cells: MatrixCell[]) {
  const totalWeight = criteria.reduce((n, c) => n + c.weight, 0);
  return options
    .map((option) => {
      if (totalWeight === 0) return { option, score: 0 };
      const sum = criteria.reduce((n, c) => {
        const cell = cells.find((x) => x.option === option && x.criterion === c.name);
        return n + (cell ? cell.expected * c.weight : 0);
      }, 0);
      return { option, score: Math.round((sum / totalWeight) * 10) / 10 };
    })
    .sort((a, b) => b.score - a.score);
}

// Totals, and the criteria the ranking turns on: drop one, re-rank, and see
// whether a different option comes first.
export function computeMatrixTotals(
  options: string[],
  criteria: MatrixCriterion[],
  cells: MatrixCell[]
): Pick<MatrixResult, "totals" | "decisiveCriteria"> {
  const totals = weightedTotals(options, criteria, cells);
  const leader = totals[0]?.option;
  const decisiveCriteria =
    criteria.length > 1
      ? criteria
          .filter((c) => {
            const without = weightedTotals(
              options,
              criteria.filter((x) => x !== c),
              cells
            );
            return without[0]?.option !== leader;
          })
          .map((c) => c.name)
      : [];
  return { totals, decisiveCriteria };
}

// ---------------------------------------------------------------------------
// Decision Matrix — scoring
// ---------------------------------------------------------------------------

function criterionQuestion(option: string, criterion: MatrixCriterion): ScoreQuestion {
  return {
    type: "score",
    instructions:
      `Based only on the Council's assessments, how well does the option "${option}" do on this criterion: ` +
      `${criterion.name}?`,
    criteria: [...MATRIX_LEVELS],
  };
}

// One Jev call per option, every criterion asked at once — they run in
// parallel inside the call, and the options run in parallel with each other.
async function scoreWithJudgment(opts: {
  runId: string;
  projectId?: string | null;
  question: string;
  options: string[];
  criteria: MatrixCriterion[];
  assessments: Array<{ member: string; text: string }>;
}): Promise<MatrixCell[]> {
  const perMember = opts.assessments.map((a) => ({ member: a.member, sections: sectionsByOption(a.text, opts.options) }));
  const results = await Promise.all(
    opts.options.map(async (option) => {
      const questions = Object.fromEntries(opts.criteria.map((c, i) => [`c${i}`, criterionQuestion(option, c)]));
      const { answers, usage, modelId } = await judge({
        state: {
          decision: opts.question,
          option,
          assessments: perMember.map((m) => ({
            member: m.member,
            text: m.sections[option].slice(0, Math.floor(STATE_CHARS / Math.max(perMember.length, 1))),
          })),
        },
        questions,
      });
      recordJudgmentUsage(opts.runId, opts.projectId, modelId, usage);
      return opts.criteria.map((c, i): MatrixCell => {
        const a = answers[`c${i}`];
        return {
          option,
          criterion: c.name,
          label: a.score,
          level: a.level,
          expected: Math.round(expectedScore(a.level, a.probabilities) * 10) / 10,
          confidence: a.confidence,
          probabilities: a.probabilities,
        };
      });
    })
  );
  return results.flat();
}

// Without Jev: one chat-model call for the whole grid, as JSON, validated as
// strictly as a typed answer would be — every option, every criterion, every
// value one of the five levels — or the run fails with a clear reason rather
// than showing a table built from a guess.
export function readModelScores(raw: string, options: string[], criteria: MatrixCriterion[]): MatrixCell[] {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("the scorer returned no JSON");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    throw new Error("the scorer's JSON didn't parse");
  }
  const scores = ((parsed as { scores?: unknown }).scores ?? parsed) as Record<string, Record<string, unknown>>;
  const cells: MatrixCell[] = [];
  for (const option of options) {
    const row = scores?.[option];
    if (!row || typeof row !== "object") throw new Error(`the scorer left out "${option}"`);
    for (const c of criteria) {
      const label = row[c.name];
      const level = MATRIX_LEVELS.findIndex((l) => typeof label === "string" && l.toLowerCase() === label.trim().toLowerCase());
      if (level < 0) throw new Error(`the scorer gave "${option}" no valid rating for "${c.name}"`);
      cells.push({ option, criterion: c.name, label: MATRIX_LEVELS[level], level, expected: expectedScore(level) });
    }
  }
  return cells;
}

async function scoreWithModel(opts: {
  runId: string;
  projectId?: string | null;
  question: string;
  options: string[];
  criteria: MatrixCriterion[];
  assessments: Array<{ member: string; text: string }>;
}): Promise<MatrixCell[]> {
  const modelId = modelForRole("synthesizer");
  const resolved = getModel(modelId);
  if (!resolved || !resolved.provider.isConfigured()) throw new Error("NO_API_KEY");
  const usage: TokenUsage[] = [];
  const shape = JSON.stringify({
    scores: Object.fromEntries(opts.options.map((o) => [o, Object.fromEntries(opts.criteria.map((c) => [c.name, "<level>"]))])),
  });
  const raw = await resolved.provider.complete({
    model: modelId,
    system:
      "You score options against criteria, based only on the assessments given. Reply with JSON only, no " +
      `commentary, in exactly this shape: ${shape} — where every <level> is one of: ${MATRIX_LEVELS.join(", ")}.`,
    messages: [
      {
        role: "user",
        content: `Decision: ${opts.question}\n\n${opts.assessments
          .map((a) => `## ${a.member}'s assessment\n${a.text}`)
          .join("\n\n")}`,
      },
    ],
    maxTokens: 4000,
    usage,
    reasoningEffort: reasoningEffortForRole("synthesizer"),
  });
  recordUsage({
    projectId: opts.projectId,
    source: "council",
    sourceId: opts.runId,
    provider: resolved.provider.id as "anthropic" | "openrouter" | "chutes",
    model: modelId,
    role: "scorer",
    usage,
  });
  return readModelScores(raw, opts.options, opts.criteria);
}

export async function scoreMatrix(opts: {
  runId: string;
  projectId?: string | null;
  question: string;
  options: string[];
  criteria: MatrixCriterion[];
  assessments: Array<{ member: string; text: string }>;
}): Promise<MatrixResult> {
  let cells: MatrixCell[] | null = null;
  let scoredBy: MatrixResult["scoredBy"] = "jev";
  if (isJudgmentConfigured()) {
    try {
      cells = await scoreWithJudgment(opts);
    } catch (err) {
      console.error("[council] Jev scoring failed; asking the Synthesizer model", err instanceof Error ? err.message : err);
    }
  }
  if (!cells) {
    scoredBy = "model";
    cells = await scoreWithModel(opts);
  }
  return {
    options: opts.options,
    criteria: opts.criteria,
    scoredBy,
    cells,
    ...computeMatrixTotals(opts.options, opts.criteria, cells),
  };
}

// The scored grid as a markdown table, for the Synthesizer to write from.
export function matrixTable(result: MatrixResult): string {
  const header = `| Option | ${result.criteria.map((c) => `${c.name} (weight ${c.weight})`).join(" | ")} | Weighted /10 |`;
  const rule = `|${" --- |".repeat(result.criteria.length + 2)}`;
  const rows = (result.totals ?? []).map(({ option, score }) => {
    const cells = result.criteria.map((c) => {
      const cell = result.cells?.find((x) => x.option === option && x.criterion === c.name);
      if (!cell) return "—";
      return cell.confidence !== undefined ? `${cell.label} (${Math.round(cell.confidence * 100)}% sure)` : cell.label;
    });
    return `| ${option} | ${cells.join(" | ")} | ${score.toFixed(1)} |`;
  });
  const turnsOn = result.decisiveCriteria?.length
    ? `\n\nThe ranking turns on: ${result.decisiveCriteria.join(", ")} — without any one of these, a different option would come first.`
    : "";
  return `${header}\n${rule}\n${rows.join("\n")}${turnsOn}`;
}

// ---------------------------------------------------------------------------
// Decision Matrix — reading a request
// ---------------------------------------------------------------------------

// A Decision Matrix's inputs: 2-6 distinct options, 1-6 distinct criteria
// each weighted 1-5. Past six of either, members' assessments get too long to
// judge each cell on, and the grid stops being readable.
export function readMatrixInput(
  raw: unknown
): { ok: true; matrix: { options: string[]; criteria: MatrixCriterion[] } } | { ok: false; error: string } {
  const body = (raw ?? {}) as { options?: unknown; criteria?: unknown };
  const options = Array.isArray(body.options)
    ? body.options.map((o) => (typeof o === "string" ? o.trim() : "")).filter(Boolean)
    : [];
  if (options.length < 2 || options.length > 6) return { ok: false, error: "A Decision Matrix needs 2 to 6 options." };
  if (new Set(options.map((o) => o.toLowerCase())).size !== options.length) {
    return { ok: false, error: "Each option needs a different name." };
  }
  const criteria: MatrixCriterion[] = Array.isArray(body.criteria)
    ? body.criteria
        .map((c) => {
          const { name, weight } = (c ?? {}) as { name?: unknown; weight?: unknown };
          return { name: typeof name === "string" ? name.trim() : "", weight: Number(weight) };
        })
        .filter((c) => c.name)
    : [];
  if (criteria.length < 1 || criteria.length > 6) return { ok: false, error: "A Decision Matrix needs 1 to 6 criteria." };
  if (new Set(criteria.map((c) => c.name.toLowerCase())).size !== criteria.length) {
    return { ok: false, error: "Each criterion needs a different name." };
  }
  if (criteria.some((c) => !Number.isInteger(c.weight) || c.weight < 1 || c.weight > 5)) {
    return { ok: false, error: "Criterion weights must be whole numbers from 1 to 5." };
  }
  return { ok: true, matrix: { options, criteria } };
}
