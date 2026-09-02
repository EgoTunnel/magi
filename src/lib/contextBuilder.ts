import { db } from "@/lib/db";
import { getProject, listAncestorProjects, familyProjectIds, type Project } from "@/lib/repo/projects";
import { listMemory } from "@/lib/repo/memory";
import { listDocuments } from "@/lib/repo/documents";
import { getSkill } from "@/lib/repo/skills";
import { projectTheme } from "@/lib/files/theme";
import { ensureChunkIndex, retrieveChunks, type RetrievedChunk } from "@/lib/retrieval";
import { resolveSourceLinks } from "@/lib/sourceLinks";

const MAGI_PERSONA = `You are the intelligence currently active inside Magi, a persistent personal AI environment.
Magi's character is quiet, precise, curious, serious, warm, cultured, capable, and unhurried — like an
instrument found in an excellent library, laboratory, or design studio. Write plainly and get to the point.
Skip the enthusiasm and the throat-clearing. When you're uncertain, say so. You are one replaceable
instrument within Magi; the user's Project, memory, and archive are what actually persists here, and you
should treat them as ground truth.
search_archive looks up prior conversations, memory, documents, and artifacts — use it before claiming
you don't know something the user may have already told Magi. Only search other Projects when it's
actually relevant, and say so when you do. When the question is about time or change — when something
first came up, whether a view has shifted, what a period was spent on — use trace_thinking instead:
it returns the same material as a dated timeline. Use the calculator for anything beyond trivial
arithmetic rather than computing by hand.`;

// Fallback only: how much whole-document text gets injected in list order when
// there is nothing to retrieve *against* (no user message yet) or the passage
// index has no answer. Retrieval is the normal path; see RETRIEVAL_* below.
const DOCUMENT_BUDGET = 12000;

// The retrieval budget is larger than DOCUMENT_BUDGET because every character
// of it was selected for this turn's question, rather than being whatever
// happened to sit at the top of the first document in the list.
const RETRIEVAL_BUDGET = 24000;
const RETRIEVAL_LIMIT = 20;
// An inventory of every document title is always included, retrieval or not,
// so the model knows what exists in the Project even when a passage from it
// didn't rank — that's what makes "search the archive for X" a reasonable
// next move rather than a guess.
const INVENTORY_LIMIT = 60;

function kindLabel(kind: RetrievedChunk["kind"]): string {
  return kind === "style_guide" ? "style guide" : kind;
}

// Titles for the conversations a set of memory items came from, in one query.
function conversationTitles(ids: string[]): Map<string, string> {
  const unique = [...new Set(ids)];
  if (!unique.length) return new Map();
  const rows = db
    .prepare(`SELECT id, title FROM conversations WHERE id IN (${unique.map(() => "?").join(",")})`)
    .all(...unique) as Array<{ id: string; title: string }>;
  return new Map(rows.map((r) => [r.id, r.title]));
}

export interface RetrievedPassage {
  chunkId: string;
  kind: string;
  refId: string;
  title: string;
  chunkIndex: number;
  sourceDate: string;
  similarity?: number;
  matchedBy: "meaning" | "keyword" | "both";
  fromAnotherProject: boolean;
  // First line or so of the passage, for the Context panel — enough to
  // recognize the passage without shipping the whole thing to the client.
  preview: string;
  // Where to go to read this passage in its original place. Resolved now, not
  // at render time, so the stored provenance stays navigable.
  href?: string;
  sourceContext?: string;
}

export interface ContextProvenance {
  projectId: string;
  projectName: string;
  usedInstructions: boolean;
  usedBrandGuide: boolean;
  globalMemoryCount: number;
  projectMemoryCount: number;
  documentsUsed: { id: string; title: string; truncated: boolean }[];
  // Set when this conversation is long enough that older turns were replaced
  // by a rolling summary — how many, so the Context panel can say so.
  summarizedMessages?: number;
  // How the Project's own material got into this turn. "retrieval" means
  // passages selected against the user's message; "documents" is the
  // list-order fallback; "none" means the Project has no material at all.
  retrievalMode: "retrieval" | "documents" | "none";
  // Exactly what was retrieved, in the order it was given to the model.
  retrieved?: RetrievedPassage[];
  // Root-first — empty unless this Project is a branch of another.
  ancestorProjects: { id: string; name: string }[];
  skillUsed: { id: string; name: string } | null;
  toolCalls?: { name: string; input: unknown; result: string }[];
  // Filled in by the caller after the model call completes — buildSystemPrompt
  // runs before the call is made, so this starts absent.
  usage?: { promptTokens: number; completionTokens: number; costUsd: number | null };
  // Set only when the turn used "Auto" model selection — which real role the
  // classifier picked (see classifyModelRole in src/lib/models/registry.ts).
  autoSelectedRole?: string;
}

export async function buildSystemPrompt(opts: {
  projectId: string;
  skillId?: string | null;
  // The message this turn is answering. When present, the Project's material
  // is *retrieved against it* rather than injected in list order — this is
  // what lets a Project with a million characters of documents put the
  // relevant thousand in front of the model. Absent (or empty) falls back to
  // the head-of-each-document behaviour.
  query?: string | null;
  // A rolling summary of the turns that have aged out of this conversation's
  // live window (src/lib/conversationWindow.ts), with how many it covers.
  conversationSummary?: { text: string; messageCount: number } | null;
}): Promise<{ system: string; provenance: ContextProvenance }> {
  const project = getProject(opts.projectId);
  if (!project) throw new Error("Project not found");
  // Root-first: the top-level ancestor first, immediate parent last — read
  // top to bottom, most general to most specific, ending at "this Project."
  const ancestors = listAncestorProjects(opts.projectId);

  const globalMemory = listMemory({ scope: "global" }).filter((m) => m.status === "established");
  const projectMemory = listMemory({ projectId: opts.projectId }).filter(
    (m) => m.status === "established" && m.scope === "project"
  );
  const documents = listDocuments(opts.projectId);

  // Passage retrieval against this turn's question. Scoped to the Project's
  // family (itself, what it inherits from, and what inherits from it) — the
  // same boundary search_archive's default scope uses, so context assembly
  // and the search tool can't disagree about what "this Project" means.
  ensureChunkIndex();
  const query = opts.query?.trim();
  let retrieved: RetrievedChunk[] = [];
  if (query) {
    retrieved = await retrieveChunks(query, {
      projectId: familyProjectIds(opts.projectId),
      limit: RETRIEVAL_LIMIT,
    }).catch((err) => {
      // Retrieval is an improvement on the fallback below, never a
      // precondition for answering — a failure here costs relevance, not the
      // turn.
      console.error("[contextBuilder] retrieval failed", err instanceof Error ? err.message : err);
      return [] as RetrievedChunk[];
    });
  }

  let retrievalBudget = RETRIEVAL_BUDGET;
  const passages: RetrievedChunk[] = [];
  for (const chunk of retrieved) {
    if (chunk.content.length > retrievalBudget) break;
    passages.push(chunk);
    retrievalBudget -= chunk.content.length;
  }

  // The list-order fallback, used only when retrieval had nothing to offer:
  // an empty passage index (nothing written yet), or a turn with no question
  // to retrieve against.
  let budget = DOCUMENT_BUDGET;
  const documentBlocks: string[] = [];
  const documentsUsed: ContextProvenance["documentsUsed"] = [];
  if (!passages.length) {
    for (const doc of documents) {
      if (budget <= 0) break;
      const slice = doc.content.slice(0, budget);
      const truncated = slice.length < doc.content.length;
      documentBlocks.push(`### ${doc.title}\n${slice}${truncated ? "\n[…truncated…]" : ""}`);
      documentsUsed.push({ id: doc.id, title: doc.title, truncated });
      budget -= slice.length;
    }
  }

  let skillBlock = "";
  let skillUsed: ContextProvenance["skillUsed"] = null;
  if (opts.skillId) {
    const skill = getSkill(opts.skillId);
    if (skill) {
      skillBlock = `\n\n## Active Skill: ${skill.name}\n${skill.description ?? ""}\nFollow this method:\n${skill.instructions}`;
      skillUsed = { id: skill.id, name: skill.name };
    }
  }

  const sections = [MAGI_PERSONA];

  function pushProjectBlock(p: Project, label: string) {
    sections.push(`\n## ${label}: ${p.name}${p.tagline ? ` — ${p.tagline}` : ""}`);
    if (p.purpose) sections.push(`Purpose: ${p.purpose}`);
    if (p.instructions) sections.push(`${label} instructions (follow these; they override general preferences):\n${p.instructions}`);
  }

  for (const ancestor of ancestors) pushProjectBlock(ancestor, "Parent Project");
  pushProjectBlock(project, "Project");

  // Effective brand guide: this Project's own fields win; anything it
  // leaves unset falls through to the nearest ancestor that sets it, so a
  // branch only has to specify what actually differs from its parent.
  const brandChain = [project, ...ancestors.slice().reverse()];
  const effectiveTheme = projectTheme(brandChain);
  const effectivePhilosophy = brandChain.find((p) => p.brand_philosophy)?.brand_philosophy;

  const brandLines: string[] = [];
  if (effectivePhilosophy) brandLines.push(`Design philosophy: ${effectivePhilosophy}`);
  if (effectiveTheme?.headingFont || effectiveTheme?.bodyFont) {
    brandLines.push(`Fonts: heading — ${effectiveTheme.headingFont ?? "unspecified"}; body — ${effectiveTheme.bodyFont ?? "unspecified"}`);
  }
  const colorParts = [
    effectiveTheme?.headingColor && `primary #${effectiveTheme.headingColor}`,
    effectiveTheme?.secondaryAccentColor && `secondary accent #${effectiveTheme.secondaryAccentColor}`,
    effectiveTheme?.accentColor && `accent #${effectiveTheme.accentColor}`,
    effectiveTheme?.subtitleColor && `subtitle #${effectiveTheme.subtitleColor}`,
    effectiveTheme?.labelColor && `label #${effectiveTheme.labelColor}`,
    effectiveTheme?.bodyColor && `text #${effectiveTheme.bodyColor}`,
  ].filter(Boolean);
  if (colorParts.length) brandLines.push(`Colors: ${colorParts.join(", ")}`);
  const usedBrandGuide = brandLines.length > 0;
  if (usedBrandGuide) {
    sections.push(
      `\n## Brand Guide\nApply this brand identity in everything you produce for this Project — writing tone, visual ` +
        `descriptions, and generated files. create_docx/create_pptx/create_xlsx already apply the fonts/colors below ` +
        `automatically to headings and body text; still write content consistent with the design philosophy below, ` +
        `and use these exact colors/fonts whenever you're generating HTML, describing imagery, or otherwise making a ` +
        `visual design choice.\n${brandLines.join("\n")}`
    );
  }

  // Every remembered claim is dated and, where it came from a conversation,
  // attributed to it — so "when did I tell you that?" and "where did that come
  // from?" are answerable from the prompt rather than only from the UI.
  const memoryOrigins = conversationTitles(
    [...globalMemory, ...projectMemory].map((m) => m.source_conversation_id).filter((id): id is string => !!id)
  );
  const memoryLine = (m: (typeof globalMemory)[number]) => {
    const origin = m.source_conversation_id ? memoryOrigins.get(m.source_conversation_id) : undefined;
    // Imported memory is often a multi-line block rather than a sentence;
    // continuation lines are indented so the whole thing stays one list item
    // instead of the date appearing to caption an unrelated wall of text.
    const content = m.content.replace(/\n/g, "\n  ");
    return `- (${m.created_at.slice(0, 10)}${origin ? `, from "${origin}"` : ""}) ${content}`;
  };

  if (globalMemory.length) {
    sections.push(
      `\n## Global memory (deliberately retained facts about the user, applicable everywhere)\nEach item is ` +
        `dated, and attributed to the conversation it came from where there was one. If the user asks where ` +
        `something you know came from, use this rather than guessing.\n${globalMemory.map(memoryLine).join("\n")}`
    );
  }
  if (projectMemory.length) {
    sections.push(
      `\n## Project memory (established knowledge specific to this Project)\n${projectMemory.map(memoryLine).join("\n")}`
    );
  }
  const passageLinks = resolveSourceLinks(passages.map((p) => ({ kind: p.kind, refId: p.refId })));

  if (passages.length) {
    const blocks = passages.map((p, i) => {
      const elsewhere = p.projectId && p.projectId !== opts.projectId ? ", from a related Project" : "";
      const date = p.sourceDate.slice(0, 10);
      return `[P${i + 1}] (${kindLabel(p.kind)}${elsewhere}, ${date}) ${p.title}\n${p.content}`;
    });
    sections.push(
      `\n## Retrieved from this Project (selected for this message)\nThese passages were pulled from the Project's ` +
        `documents, past conversations, artifacts, and memory because they are the closest match to what the user just ` +
        `asked — they are extracts, not the whole of anything. Treat them as ground truth about this Project and cite ` +
        `them as [P1], [P2] when you rely on one. This is a selection, not an inventory: if the answer needs material ` +
        `these passages only gesture at, call search_archive rather than assuming nothing else exists.\n\n` +
        blocks.join("\n\n")
    );
  }
  if (documentBlocks.length) {
    sections.push(`\n## Project documents\n${documentBlocks.join("\n\n")}`);
  }
  // Always present, retrieval or not: knowing a document exists is different
  // from having read it, and the model needs the former to search well.
  if (documents.length) {
    const listed = documents.slice(0, INVENTORY_LIMIT);
    const more = documents.length - listed.length;
    sections.push(
      `\n## Documents in this Project (titles only — use search_archive to read one)\n` +
        listed.map((d) => `- ${d.title} (${d.content.length.toLocaleString()} characters)`).join("\n") +
        (more > 0 ? `\n- …and ${more} more` : "")
    );
  }
  // Last among the context blocks and immediately before any Skill: this is
  // the nearest thing to the live turns that follow it, and reads as their
  // preamble rather than as more Project background.
  if (opts.conversationSummary?.text) {
    sections.push(
      `\n## Earlier in this conversation\nThis conversation is long enough that its first ` +
        `${opts.conversationSummary.messageCount} messages are summarized here rather than sent in full. The ` +
        `messages that follow are the most recent turns, verbatim. Treat this summary as an accurate record of ` +
        `what was said and decided; if you need the exact wording of something in it, say so rather than ` +
        `inventing a quote.\n\n${opts.conversationSummary.text}`
    );
  }
  if (skillBlock) sections.push(skillBlock);

  return {
    system: sections.join("\n"),
    provenance: {
      projectId: project.id,
      projectName: project.name,
      usedInstructions: !!project.instructions,
      usedBrandGuide,
      ancestorProjects: ancestors.map((a) => ({ id: a.id, name: a.name })),
      globalMemoryCount: globalMemory.length,
      projectMemoryCount: projectMemory.length,
      documentsUsed,
      summarizedMessages: opts.conversationSummary?.messageCount,
      retrievalMode: passages.length ? "retrieval" : documentBlocks.length ? "documents" : "none",
      retrieved: passages.length
        ? passages.map((p) => {
            const link = passageLinks.get(`${p.kind}:${p.refId}`);
            return {
              chunkId: p.chunkId,
              kind: p.kind,
              refId: p.refId,
              title: p.title,
              chunkIndex: p.chunkIndex,
              sourceDate: p.sourceDate,
              similarity: p.similarity,
              matchedBy: p.matchedBy,
              fromAnotherProject: !!p.projectId && p.projectId !== opts.projectId,
              preview: p.content.replace(/\s+/g, " ").slice(0, 160),
              href: link?.href,
              sourceContext: link?.context || undefined,
            };
          })
        : undefined,
      skillUsed,
    },
  };
}
