import { getConversation, getActivePath, type Message } from "@/lib/repo/conversations";
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
import {
  addPersonFact,
  associate,
  clearSuggestedPeopleForConversation,
  createPerson,
  findPersonByName,
  listPeople,
  listPeopleForClosure,
  type Person,
} from "@/lib/repo/people";
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
  "Use exactly these six labeled sections, in this order, and nothing else:\n\n" +
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
  "propose something here only when it is clearly not Project-specific.\n\n" +
  "People:\n" +
  "One bullet per person, written exactly as \"Name — what was learned about them here.\" Only people the " +
  "user has a real working relationship with: colleagues, clients, collaborators, people they meet or " +
  "correspond with, family. This is a rolodex of the user's actual working life, not an index of everyone " +
  "the conversation named.\n" +
  "Do NOT propose historical figures, authors, researchers, public figures, fictional characters, or " +
  "anyone who is the SUBJECT MATTER of the conversation rather than a participant in the user's work. A " +
  "conversation about Alan Turing, Marshall McLuhan, or a film director proposes nobody, however much was " +
  "said about them. The test is whether the user has a relationship with this person, not whether the " +
  "person was discussed.\n" +
  "Where the user's known people are listed for you below, match one by their exact name or alias and use " +
  "that exact spelling. Never assume a similar name is the same person — if you are not certain it is the " +
  "same human, write the name as it appeared and let the user decide.\n" +
  "Write \"None.\" if there are none, which is the common case.";

// Bounded on purpose: closing a 900,000-character conversation must not cost
// more than the conversation did. The rolling summary already covers the early
// turns for any conversation long enough for this cap to bite.
const CLOSE_TAIL_BUDGET = 60000;

export interface ClosureDraft {
  closure: EpisodeClosure;
  notes: ProjectNote[];
  memory: MemoryItem[];
  // People this closing proposed, or already-known people it learned something
  // new about, each with the facts it proposed for them.
  people: Array<{ person: Person; facts: MemoryItem[] }>;
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
  "people",
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

// Splits "Keith — cares about accessibility in every review." into a name and
// what was learned. Models write the separator as an em dash, an en dash, a
// hyphen, or a colon, so all four are accepted.
//
// A line with no separator is only treated as a bare name when it plausibly is
// one: short, and not a sentence. Without that guard a model that ignored the
// format would turn a whole sentence about someone into a person named after
// the sentence — and a junk name in a rolodex is worse than a missed one,
// because the user has to clean it up.
const MAX_BARE_NAME_LENGTH = 60;

export function parsePersonLine(line: string): { name: string; fact: string | null } | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^(.+?)\s*(?:—|–|:|\s-\s)\s*([\s\S]+)$/);
  if (match) {
    const name = match[1].trim();
    const fact = match[2].trim();
    if (!name || name.length > MAX_BARE_NAME_LENGTH) return null;
    return { name, fact: fact || null };
  }
  if (trimmed.length > MAX_BARE_NAME_LENGTH || /[.!?]/.test(trimmed)) return null;
  return { name: trimmed, fact: null };
}

// The known roster, handed to the model so it can match someone it recognizes
// instead of proposing a duplicate. Names and aliases only — what is known
// about them is not the closing model's business.
function rosterBlock(): string {
  const people = listPeople({ status: "established" });
  if (!people.length) return "";
  const listed = people
    .slice(0, 60)
    .map((p) => (p.aliases.length ? `${p.name} (also: ${p.aliases.join(", ")})` : p.name));
  return (
    `\n\nPeople already recorded (match by these exact names or aliases; anyone not listed is a new ` +
    `proposal): ${listed.join("; ")}${people.length > 60 ? `; and ${people.length - 60} more` : ""}.`
  );
}

// Drafts (or redrafts) the close-out of one conversation. Replaces any previous
// draft for the same conversation, sparing whatever the user already kept.
export async function draftClosure(conversationId: string): Promise<ClosureDraft> {
  const conversation = getConversation(conversationId);
  if (!conversation) throw new Error("Conversation not found");
  // The active branch only — closing an episode should summarize what the
  // user actually experienced, not a branch they edited away or regenerated
  // past.
  const messages = getActivePath(conversationId).filter((m) => m.role === "user" || m.role === "assistant");
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
          `Project: ${getProject(conversation.project_id)?.name ?? "Unknown"}\nConversation: ${conversation.title}` +
          `${rosterBlock()}\n\n` +
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
    provider: resolved.provider.id as "anthropic" | "openrouter" | "chutes",
    model: modelId,
    role: "synthesizer",
    usage,
  });

  const sections = splitSections(reply);
  // A model that ignored the section format entirely still produces a usable
  // summary — better than an error and an empty draft.
  const summary = (sections["summary"] ?? extractDelimited(reply)).trim();

  // Replace the previous draft only now that a new one actually exists. Both
  // people clearers run before deleteClosuresForConversation, because they find
  // what to clear by joining through the closure rows it deletes.
  clearSuggestedForConversation(conversationId);
  clearSuggestedPeopleForConversation(conversationId);
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

  // People. A name the roster already knows becomes a new suggested fact on the
  // person who is already there; an unknown name becomes a suggested person as
  // well. Either way the association with this Project is proposed, not made:
  // being on a Project's roster puts someone into every prompt in it, which is
  // more than a closing gets to decide on its own.
  for (const line of bullets(sections["people"])) {
    const parsed = parsePersonLine(line);
    if (!parsed) continue;
    const existing = findPersonByName(parsed.name);
    const personId =
      existing?.id ??
      createPerson({
        name: parsed.name,
        status: "suggested",
        closureId: closure.id,
        sourceConversationId: conversationId,
      }).id;
    if (parsed.fact) {
      addPersonFact({
        personId,
        content: parsed.fact,
        status: "suggested",
        source: `episode:${conversationId}`,
        closureId: closure.id,
        sourceConversationId: conversationId,
      });
    }
    associate(conversation.project_id, personId, null, { status: "suggested", closureId: closure.id });
  }

  return {
    closure,
    notes: listNotesForClosure(closure.id),
    memory: listMemoryForClosure(closure.id),
    people: listPeopleForClosure(closure.id),
  };
}

export function getDraft(conversationId: string): ClosureDraft | null {
  const closure = getClosureForConversation(conversationId);
  if (!closure) return null;
  return {
    closure,
    notes: listNotesForClosure(closure.id),
    memory: listMemoryForClosure(closure.id),
    people: listPeopleForClosure(closure.id),
  };
}
