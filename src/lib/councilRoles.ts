// The default members for each Council mode — shared by the Councils page and
// "Ask the Council" in a conversation (src/lib/councilInConversation.ts), so
// both convene the same Council for the same mode. Plain data with no server
// imports: the Councils page is a client component and imports this too.
import type { CouncilMode, CouncilRole } from "@/lib/repo/councils";

// "Historian → research tools" (Product Vision §45) — the Researcher's job is
// to go find things, so it gets search + web.
const RESEARCH_TOOLS = ["search_archive", "web_search", "web_fetch"];
// "Skeptic → web + archive" (Product Vision §45).
const SKEPTIC_TOOLS = ["search_archive", "web_search", "web_fetch"];
// The Reasoner/Advocate/Proposer's job is to work through the material
// already given to it (Project documents, attachments, the question itself),
// not go hunting for more — verified live: with search_archive available,
// a reasoning-heavy model reliably burned its whole tool budget re-querying
// for a document already sitting in its own context, and returned no answer
// at all, while the Critic and Researcher roles (which have an actual reason
// to look things up) used the same material directly and correctly. An empty
// array — not null — means no tools at all, not "whatever's globally
// enabled."
const NO_TOOLS: string[] = [];

const INDEPENDENT_DEFAULT_ROLES: CouncilRole[] = [
  {
    name: "Reasoner",
    modelRole: "reasoner",
    systemPrompt: "You are the Reasoner on a Magi Council. Work through the question carefully and rigorously, step by step. State your conclusion plainly.",
    allowedTools: NO_TOOLS,
  },
  {
    name: "Critic",
    modelRole: "critic",
    systemPrompt: "You are the Critic on a Magi Council. Be skeptical. Look for weak assumptions, missing evidence, and overreach. Argue against easy conclusions.",
    allowedTools: SKEPTIC_TOOLS,
  },
  {
    name: "Researcher",
    modelRole: "researcher",
    systemPrompt: "You are the Researcher on a Magi Council. Bring relevant context, precedent, and grounded detail to the question.",
    allowedTools: RESEARCH_TOOLS,
  },
];

// Deliberately topic-agnostic — the question varies, these two stances don't
// presuppose which side of it is "for" or "against."
const DEBATE_DEFAULT_ROLES: CouncilRole[] = [
  {
    name: "Advocate",
    modelRole: "reasoner",
    systemPrompt: "You are the Advocate on a Magi Council Debate. Argue for the strongest, most defensible position on the question — make the best possible case for it.",
    allowedTools: NO_TOOLS,
  },
  {
    name: "Skeptic",
    modelRole: "critic",
    systemPrompt: "You are the Skeptic on a Magi Council Debate. Argue against that position, or for a genuinely different one. Raise the strongest doubts and counter-considerations you can.",
    allowedTools: SKEPTIC_TOOLS,
  },
];

const RED_TEAM_DEFAULT_ROLES: CouncilRole[] = [
  {
    name: "Proposer",
    modelRole: "reasoner",
    systemPrompt: "You are the Proposer on a Magi Council Red Team exercise. Answer the question directly and substantively — this will be attacked, so give your real best answer, not a hedge.",
    allowedTools: NO_TOOLS,
  },
  {
    name: "Red Team",
    modelRole: "critic",
    systemPrompt: "You are the Red Team on a Magi Council. Attack the Proposer's answer aggressively — find every weakness, edge case, and flaw you can. Do not be diplomatic about it.",
    allowedTools: SKEPTIC_TOOLS,
  },
];

export const DEFAULT_COUNCIL_ROLES: Record<CouncilMode, CouncilRole[]> = {
  independent: INDEPENDENT_DEFAULT_ROLES,
  debate: DEBATE_DEFAULT_ROLES,
  redTeam: RED_TEAM_DEFAULT_ROLES,
  // A Decision Matrix wants the same spread of perspectives as an open question.
  matrix: INDEPENDENT_DEFAULT_ROLES,
};
