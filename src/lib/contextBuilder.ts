import { getProject, listAncestorProjects, type Project } from "@/lib/repo/projects";
import { listMemory } from "@/lib/repo/memory";
import { listDocuments } from "@/lib/repo/documents";
import { getSkill } from "@/lib/repo/skills";
import { projectTheme } from "@/lib/files/theme";

const MAGI_PERSONA = `You are the intelligence currently active inside Magi, a persistent personal AI environment.
Magi's character is quiet, precise, curious, serious, warm, cultured, capable, and unhurried — like an
instrument found in an excellent library, laboratory, or design studio. Write plainly and get to the point.
Skip the enthusiasm and the throat-clearing. When you're uncertain, say so. You are one replaceable
instrument within Magi; the user's Project, memory, and archive are what actually persists here, and you
should treat them as ground truth.
search_archive looks up prior conversations, memory, documents, and artifacts — use it before claiming
you don't know something the user may have already told Magi. Only search other Projects when it's
actually relevant, and say so when you do. Use the calculator for anything beyond trivial arithmetic
rather than computing by hand.`;

const DOCUMENT_BUDGET = 12000;

export interface ContextProvenance {
  projectId: string;
  projectName: string;
  usedInstructions: boolean;
  usedBrandGuide: boolean;
  globalMemoryCount: number;
  projectMemoryCount: number;
  documentsUsed: { id: string; title: string; truncated: boolean }[];
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

export function buildSystemPrompt(opts: {
  projectId: string;
  skillId?: string | null;
}): { system: string; provenance: ContextProvenance } {
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

  let budget = DOCUMENT_BUDGET;
  const documentBlocks: string[] = [];
  const documentsUsed: ContextProvenance["documentsUsed"] = [];
  for (const doc of documents) {
    if (budget <= 0) break;
    const slice = doc.content.slice(0, budget);
    const truncated = slice.length < doc.content.length;
    documentBlocks.push(`### ${doc.title}\n${slice}${truncated ? "\n[…truncated…]" : ""}`);
    documentsUsed.push({ id: doc.id, title: doc.title, truncated });
    budget -= slice.length;
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

  if (globalMemory.length) {
    sections.push(`\n## Global memory (deliberately retained facts about the user, applicable everywhere)\n${globalMemory.map((m) => `- ${m.content}`).join("\n")}`);
  }
  if (projectMemory.length) {
    sections.push(`\n## Project memory (established knowledge specific to this Project)\n${projectMemory.map((m) => `- ${m.content}`).join("\n")}`);
  }
  if (documentBlocks.length) {
    sections.push(`\n## Project documents\n${documentBlocks.join("\n\n")}`);
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
      skillUsed,
    },
  };
}
