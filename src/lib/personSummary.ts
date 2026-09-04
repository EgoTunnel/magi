import { getModel, modelForRole, reasoningEffortForRole } from "@/lib/models/registry";
import type { TokenUsage } from "@/lib/models/types";
import { recordUsage } from "@/lib/repo/usage";
import { listMemory } from "@/lib/repo/memory";
import { getPerson, listPersonMentions, setSuggestedSummary, type Person } from "@/lib/repo/people";

// Delimiters, not "output only the sentence" — the same fix episode closings
// needed, for the same reason. Several models have mandatory reasoning they
// cannot be told to skip, and it lands in the visible reply: verified here, the
// assigned fast model returned a page of "Let's count the characters…" instead
// of a summary. Anything outside the markers is discarded, so thinking out loud
// is harmless rather than becoming the summary.
const OUTPUT_START = "<<<SUMMARY>>>";
const OUTPUT_END = "<<<END>>>";

const SYSTEM =
  "You write one line describing how a person relates to the user's work, for a personal rolodex.\n\n" +
  "You are given what the user has deliberately recorded about them and a few passages mentioning them. " +
  "Write a single sentence, under 140 characters, in plain declarative prose. No name at the start (the " +
  "page already shows it), no honorifics, no adjectives of praise, no speculation about their character " +
  "or intentions.\n\n" +
  "Say only what the recorded facts support. If they support very little, write a short, dull line that " +
  "says only that much — an accurate thin summary is worth more than a fluent invented one.\n\n" +
  `Put the finished sentence between a line containing exactly ${OUTPUT_START} and a line containing ` +
  `exactly ${OUTPUT_END}. Anything outside those markers is discarded, so do all of your thinking before ` +
  "the opening marker. Between the markers write the sentence and nothing else — no quotation marks, no " +
  "commentary, no character counts.";

// Keeps only what the model put between the delimiters, then unwraps the
// quotation marks models add despite being told not to. A reply that ignored
// the markers entirely yields nothing rather than a paragraph of reasoning
// presented as a summary — failing visibly is the right outcome there.
export function extractSummary(reply: string): string | null {
  const start = reply.indexOf(OUTPUT_START);
  if (start === -1) return null;
  const body = reply.slice(start + OUTPUT_START.length);
  const end = body.indexOf(OUTPUT_END);
  const inner = (end === -1 ? body : body.slice(0, end)).trim();
  const line = inner
    .split("\n")
    .map((l) => l.trim())
    .find(Boolean);
  if (!line) return null;
  const cleaned = line.replace(/^["“](.*)["”]$/, "$1").trim();
  return cleaned.length ? cleaned : null;
}

export type DraftSummaryResult =
  | { ok: true; person: Person | null }
  | { ok: false; error: "NO_FACTS" | "NO_API_KEY" | "EMPTY"; message: string };

// Drafts a one-line summary from what is already known, as a proposal. The
// summary is the part of a person record most likely to go stale, because facts
// accumulate underneath it and nobody rewrites it by hand.
export async function draftPersonSummary(personId: string): Promise<DraftSummaryResult | null> {
  const person = getPerson(personId);
  if (!person) return null;

  const facts = listMemory({ personId }).filter((f) => f.status === "established");
  if (!facts.length) {
    return {
      ok: false,
      error: "NO_FACTS",
      message: "Record a fact or two about them first — there is nothing to summarize yet.",
    };
  }

  // The "writer" role, not "fast". This looked like a fast-role task — one
  // short sentence — but `fast` is assigned a mandatory-reasoning model
  // (docs/Handoff.md lesson #9 names it for breaking the role classifier the
  // same way), and it reliably spent its whole budget deliberating about
  // character counts instead of emitting the delimiters. Verified: it produced
  // "10 d? Let's simpler use known length approx…" as a person's summary.
  // Shaped output needs a model that follows the shape; this call is rare and
  // user-initiated, so paying for that is the right trade.
  const modelId = modelForRole("writer");
  const resolved = getModel(modelId);
  if (!resolved || !resolved.provider.isConfigured()) {
    return { ok: false, error: "NO_API_KEY", message: "No API key configured. Add one in Settings first." };
  }

  const mentions = await listPersonMentions(person, { limit: 5 })
    .then((r) => r.mentions)
    .catch(() => []);

  const usage: TokenUsage[] = [];
  const reply = await resolved.provider.complete({
    model: modelId,
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content:
          `Person: ${person.name}\n` +
          (person.relationship ? `Relationship to the user: ${person.relationship}\n` : "") +
          `\nRecorded facts:\n${facts.map((f) => `- ${f.content}`).join("\n")}\n` +
          (mentions.length
            ? `\nPassages mentioning them:\n${mentions
                .map((m) => `- ${m.content.replace(/\s+/g, " ").slice(0, 300)}`)
                .join("\n")}\n`
            : "") +
          `\nWrite the one-line summary.`,
      },
    ],
    // Generous on purpose: a reasoning model spends an unpredictable share of
    // its budget before writing the first visible word, and a starved budget
    // produces a confident-looking fragment rather than an obvious error.
    maxTokens: 2000,
    usage,
    reasoningEffort: reasoningEffortForRole("writer"),
  });
  recordUsage({
    source: "people_interest",
    sourceId: personId,
    provider: resolved.provider.id as "anthropic" | "openrouter" | "chutes",
    model: modelId,
    role: "writer",
    usage,
  });

  const drafted = extractSummary(reply);
  if (!drafted) {
    return { ok: false, error: "EMPTY", message: "The model didn't return a usable summary. Try again." };
  }
  return { ok: true, person: setSuggestedSummary(personId, drafted) };
}
