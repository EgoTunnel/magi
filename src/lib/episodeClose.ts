import { getConversation, listMessages, type Message } from "@/lib/repo/conversations";
import { getConversationSummary } from "@/lib/conversationWindow";
import { createMemory, clearSuggestedForConversation, listMemoryForClosure, type MemoryItem } from "@/lib/repo/memory";
import {
  clearProposedNotes,
  createProjectNote,
  listNotesForClosure,
  type ProjectNote,
} from "@/lib/repo/projectNotes";
import {
  createClosure,
  deleteClosuresForConversation,
  getClosureForConversation,
  type EpisodeClosure,
} from "@/lib/repo/episodes";
import { getProject } from "@/lib/repo/projects";
import { getModel, modelForRole, reasoningEffortForRole } from "@/lib/models/registry";
import type { TokenUsage } from "@/lib/models/types";
import { recordUsage } from "@/lib/repo/usage";

// The Vision says a conversation is an episode. Episodes have a lifecycle, and
// this is its end: a deliberate, user-initiated pass that reads the whole thing
// and drafts what should outlive it. Nothing here is automatic and nothing here
// takes effect on its own — every proposal lands in a state the prompt builder
// ignores until a human keeps it.
// Some models have mandatory reasoning they cannot be told to skip (the same
// lesson the role classifier learned — see docs/Handoff.md), and it lands in
// the visible reply, where it parses as content. Verified live: deepseek-v4-pro
// at effort "high" proposed a "decision" reading "Is that a decision? Not
// exactly but can be a settled fact...". Explicit delimiters are the
// model-agnostic fix — anything outside them is discarded rather than parsed.
const OUTPUT_START = "<<<CLOSEOUT>>>";
const OUTPUT_END = "<<<END>>>";

const CLOSE_SYSTEM_PROMPT =
  "You are closing out a working conversation, writing the record of it that will outlive the transcript. " +
  "Be exact and unsentimental. Everything you write will be reviewed item by item and either kept or " +
  "thrown away, so propose things worth the reviewer's attention rather than padding each section.\n\n" +
  `Put your entire answer between a line containing exactly ${OUTPUT_START} and a line containing exactly ` +
  `${OUTPUT_END}. Anything outside those markers is discarded, so do all of your thinking before the ` +
  "opening marker and write nothing after the closing one.\n\n" +
  "Inside the markers, write only the finished record. Do not narrate your reasoning, weigh options aloud, " +
  "second-guess a choice, address the reader, or comment on your own output — no \"Is this a decision?\", " +
  "no \"Good.\", no \"maybe\". If you are unsure whether something belongs in a section, leave it out. Write " +
  "each bullet as a plain declarative statement with no surrounding quotation marks.\n\n" +
  "Use exactly these five labeled sections, in this order, and nothing else:\n\n" +
  "Summary:\n" +
  "Two to five sentences on what this conversation was for and where it ended up. Past tense, specific, " +
  "no preamble.\n\n" +
  "Decisions:\n" +
  "One bullet per decision that was actually settled here, each stating the decision and, briefly, why. " +
  "A decision is something now treated as fixed — not an option that was discussed. Write \"None.\" if " +
  "nothing was settled.\n\n" +
  "Open questions:\n" +
  "One bullet per question this conversation raised and did not answer, phrased as a question. Include " +
  "things that were deferred, blocked, or explicitly left for later. Write \"None.\" if nothing is open.\n\n" +
  "Remember in this Project:\n" +
  "One bullet per durable fact about THIS Project's subject matter that a future conversation would be " +
  "worse off not knowing — terminology, constraints, conclusions, the state of the work. Each bullet must " +
  "stand alone, out of context, months from now: no \"the above\", no \"as discussed\". Not a summary of " +
  "the conversation, and not a to-do. Write \"None.\" if there is nothing durable.\n\n" +
  "Remember globally:\n" +
  "One bullet per durable fact about the USER — how they work, what they prefer, stable facts about their " +
  "situation — that would apply in an unrelated Project too. This section should usually be \"None.\"; " +
  "propose something here only when it is clearly not Project-specific.";

// Bounded on purpose: closing a 900,000-character conversation must not cost
// more than the conversation did. The rolling summary already covers the early
// turns for any conversation long enough for this cap to bite.
const CLOSE_TAIL_BUDGET = 60000;

export interface ClosureDraft {
  closure: EpisodeClosure;
  notes: ProjectNote[];
  memory: MemoryItem[];
}

function transcriptTail(messages: Message[]): string {
  const text = messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
    .join("\n\n");
  return text.length > CLOSE_TAIL_BUDGET ? text.slice(-CLOSE_TAIL_BUDGET) : text;
}

// The codebase's convention for structured model output is labeled prose
// sections, not JSON (see connections.ts) — more robust across providers, and
// a model that drifts slightly still parses. Section headings are matched
// case-insensitively at the start of a line.
const SECTION_KEYS = [
  "summary",
  "decisions",
  "open questions",
  "remember in this project",
  "remember globally",
] as const;

// A heading is recognized by stripping its decoration and comparing, rather
// than by a pattern that has to anticipate every way a model might dress one
// up. Models emit "Decisions:", "**Decisions:**", "**Decisions**:", and
// "## Decisions" interchangeably, and a pattern that misses one silently
// swallows the whole section into the section above it.
function headingKey(line: string): string | null {
  const bare = line
    .replace(/[#*_`]/g, "")
    .replace(/:/g, "")
    .trim()
    .toLowerCase();
  return (SECTION_KEYS as readonly string[]).includes(bare) ? bare : null;
}

// Keeps only what the model put between the delimiters. A model that ignored
// them entirely still parses — the whole reply is used, as before.
export function extractDelimited(reply: string): string {
  const start = reply.indexOf(OUTPUT_START);
  if (start === -1) return reply;
  const body = reply.slice(start + OUTPUT_START.length);
  const end = body.indexOf(OUTPUT_END);
  return end === -1 ? body : body.slice(0, end);
}

export function splitSections(reply: string): Record<string, string> {
  const out: Record<string, string> = {};
  let current: string | null = null;
  for (const line of extractDelimited(reply).split("\n")) {
    const key = headingKey(line);
    if (key) {
      current = key;
      out[current] = "";
      continue;
    }
    if (current) out[current] += `${line}\n`;
  }
  return out;
}

export function bullets(section: string | undefined): string[] {
  if (!section) return [];
  return section
    .split("\n")
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
    .filter((line) => line.length > 0)
    // A model told to write "None." when a section is empty does exactly that,
    // and it must not become a proposal saying "None."
    .filter((line) => !/^none\.?$/i.test(line))
    .map((line) => line.replace(/^\*\*(.+?)\*\*:?\s*/, "$1: "))
    // Models wrap bullets in quotation marks despite being told not to; the
    // quotes would then be stored verbatim into memory and read back forever.
    .map((line) => line.replace(/^["“]([\s\S]*)["”]$/, "$1").trim())
    .filter((line) => line.length > 0);
}

// Drafts (or redrafts) the close-out of one conversation. Replaces any previous
// draft for the same conversation, sparing whatever the user already kept.
export async function draftClosure(conversationId: string): Promise<ClosureDraft> {
  const conversation = getConversation(conversationId);
  if (!conversation) throw new Error("Conversation not found");
  const messages = listMessages(conversationId).filter((m) => m.role === "user" || m.role === "assistant");
  if (messages.length === 0) throw new Error("There is nothing in this conversation to close.");

  const modelId = modelForRole("synthesizer");
  const resolved = getModel(modelId);
  if (!resolved || !resolved.provider.isConfigured()) throw new Error("NO_API_KEY");

  const rolling = getConversationSummary(conversationId);
  const priorBlock = rolling.summary
    ? `Summary of the first ${rolling.count} messages:\n\n${rolling.summary}\n\n---\n\nTranscript of the rest:\n\n`
    : "Transcript:\n\n";

  const usage: TokenUsage[] = [];
  const reply = await resolved.provider.complete({
    model: modelId,
    system: CLOSE_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content:
          `Project: ${getProject(conversation.project_id)?.name ?? "Unknown"}\nConversation: ${conversation.title}\n\n` +
          `${priorBlock}${transcriptTail(messages)}`,
      },
    ],
    // Generous on purpose: a reasoning model spends an unpredictable share of
    // this budget before it writes the first visible word, and a draft that
    // runs out mid-bullet stores a truncated fragment as a memory proposal.
    maxTokens: 6000,
    usage,
    reasoningEffort: reasoningEffortForRole("synthesizer"),
  });
  recordUsage({
    projectId: conversation.project_id,
    source: "conversation",
    sourceId: conversationId,
    provider: resolved.provider.id as "anthropic" | "openrouter",
    model: modelId,
    role: "synthesizer",
    usage,
  });

  const sections = splitSections(reply);
  // A model that ignored the section format entirely still produces a usable
  // summary — better than an error and an empty draft.
  const summary = (sections["summary"] ?? extractDelimited(reply)).trim();

  // Replace the previous draft only now that a new one actually exists.
  clearSuggestedForConversation(conversationId);
  clearProposedNotes(conversationId);
  deleteClosuresForConversation(conversationId);

  const closure = createClosure({
    conversationId,
    projectId: conversation.project_id,
    summary,
    messageCount: messages.length,
    throughMessageId: messages[messages.length - 1].id,
  });

  for (const content of bullets(sections["decisions"])) {
    createProjectNote({
      projectId: conversation.project_id,
      kind: "decision",
      content,
      conversationId,
      closureId: closure.id,
    });
  }
  for (const content of bullets(sections["open questions"])) {
    createProjectNote({
      projectId: conversation.project_id,
      kind: "question",
      content,
      conversationId,
      closureId: closure.id,
    });
  }
  for (const content of bullets(sections["remember in this project"])) {
    createMemory({
      scope: "project",
      projectId: conversation.project_id,
      content,
      source: `episode:${conversationId}`,
      status: "suggested",
      closureId: closure.id,
      // An episode's proposals come from the conversation as a whole, not from
      // any one message — so only the conversation is recorded here.
      sourceConversationId: conversationId,
    });
  }
  for (const content of bullets(sections["remember globally"])) {
    createMemory({
      scope: "global",
      content,
      source: `episode:${conversationId}`,
      status: "suggested",
      closureId: closure.id,
      sourceConversationId: conversationId,
    });
  }

  return {
    closure,
    notes: listNotesForClosure(closure.id),
    memory: listMemoryForClosure(closure.id),
  };
}

export function getDraft(conversationId: string): ClosureDraft | null {
  const closure = getClosureForConversation(conversationId);
  if (!closure) return null;
  return {
    closure,
    notes: listNotesForClosure(closure.id),
    memory: listMemoryForClosure(closure.id),
  };
}
