import { getProject } from "@/lib/repo/projects";
import { listMemory } from "@/lib/repo/memory";
import { listDocuments } from "@/lib/repo/documents";
import { getSkill } from "@/lib/repo/skills";

const MAGI_PERSONA = `You are the intelligence currently active inside Magi, a persistent personal AI environment.
Magi's character is quiet, precise, curious, serious, warm, cultured, capable, and unhurried — like an
instrument found in an excellent library, laboratory, or design studio. Be substantive rather than
performative. Do not open with unearned enthusiasm or filler. Write with editorial clarity. When you are
uncertain, say so plainly. You are one replaceable instrument within Magi; the user's Project, memory, and
archive are the durable things — treat them as the ground truth of this workspace, not as decoration.
You have tools available: search_archive can look up prior conversations, memory, documents, and
artifacts — use it before claiming you don't know something the user may already have told Magi, rather
than guessing. Only search across other Projects when it's actually relevant, and say plainly when you've
drawn on another Project. calculator is available for anything beyond trivial arithmetic — use it rather
than computing by hand.`;

const DOCUMENT_BUDGET = 12000;

export interface ContextProvenance {
  projectId: string;
  projectName: string;
  usedInstructions: boolean;
  globalMemoryCount: number;
  projectMemoryCount: number;
  documentsUsed: { id: string; title: string; truncated: boolean }[];
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

  sections.push(`\n## Project: ${project.name}${project.tagline ? ` — ${project.tagline}` : ""}`);
  if (project.purpose) sections.push(`Purpose: ${project.purpose}`);
  if (project.instructions) sections.push(`Project instructions (follow these; they override general preferences):\n${project.instructions}`);

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
      globalMemoryCount: globalMemory.length,
      projectMemoryCount: projectMemory.length,
      documentsUsed,
      skillUsed,
    },
  };
}
