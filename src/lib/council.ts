import { getModel, modelForRole, reasoningEffortForRole } from "@/lib/models/registry";
import type { ModelRoleId, TokenUsage, ToolCallRecord } from "@/lib/models/types";
import type { CouncilMode, CouncilRole, CouncilTranscriptEntry, RunAttachment } from "@/lib/repo/councils";
import { updateCouncilRun } from "@/lib/repo/councils";
import { getProject } from "@/lib/repo/projects";
import { listDocuments } from "@/lib/repo/documents";
import { resolveTools, executeTool } from "@/lib/tools/registry";
import { recordUsage } from "@/lib/repo/usage";
import { composeSkill, composeSystemPrompt, isModelRole, narrowTools, preferredRole } from "@/lib/skillComposition";

// Same budget contextBuilder.ts uses for Project documents in a normal chat
// turn — keeps a Council role's system prompt from growing unbounded when a
// Project has a lot of documents.
const DOCUMENT_BUDGET = 12000;

// Every Council member's only reliable path to "the material" used to be
// search_archive — a keyword-FTS tool that ANDs every search term and
// returns snippets, not full text — with no explanation of what it is or
// that Project material might already be available. This is what actually
// gives every role, every stage, the real thing to look at.
function buildContextBlock(projectId: string | null | undefined, attachments: RunAttachment[]): string {
  const parts: string[] = [];
  const project = projectId ? getProject(projectId) : null;
  if (project) {
    parts.push(`\n\n## Project — "${project.name}"${project.purpose ? `: ${project.purpose}` : ""}`);
    if (project.instructions) parts.push(`Project instructions: ${project.instructions}`);
    const documents = listDocuments(project.id);
    let budget = DOCUMENT_BUDGET;
    const blocks: string[] = [];
    for (const doc of documents) {
      if (budget <= 0) break;
      const slice = doc.content.slice(0, budget);
      blocks.push(`### ${doc.title}\n${slice}${slice.length < doc.content.length ? "\n[…truncated…]" : ""}`);
      budget -= slice.length;
    }
    if (blocks.length) parts.push(`\n## Project documents (already retrieved — read directly)\n${blocks.join("\n\n")}`);
  }
  if (attachments.length) {
    parts.push(
      `\n## Attached to this question (already retrieved — read directly)\n${attachments
        .map((a) => `### ${a.filename}\n${a.extractedText}`)
        .join("\n\n")}`
    );
  }
  return parts.join("\n");
}

const COUNCIL_TOOL_GUIDANCE =
  "You are one member of a Magi Council. Any Project documents or files attached to this question " +
  "are already included below, in full — this is not a summary or a pointer to go look something up. " +
  "Do NOT call search_archive for anything already given to you below; it is already complete and " +
  "correct, and searching for it only wastes your limited tool calls. search_archive exists only for " +
  "material NOT included below — prior conversations, established memory, or documents in other " +
  "Projects. Ground your answer in the material actually given to you or actually returned by a tool " +
  "call — say plainly when something is uncertain or unsupported rather than filling the gap with a " +
  "plausible-sounding guess.";

async function completeAs(
  role: CouncilRole,
  prompt: string,
  opts: { withTools?: boolean; projectId?: string | null; runId: string; contextBlock: string }
): Promise<{ content: string; modelId: string; toolCalls: ToolCallRecord[] }> {
  // A member may work by a Skill. Its method joins this member's own framing,
  // and it supplies the model role and tool allowlist wherever the member
  // leaves them unset — never overriding what the member explicitly states.
  const skill = composeSkill(role.skillId);
  const roleId = preferredRole(isModelRole(role.modelRole) ? role.modelRole : null, skill, "default");
  const modelId = modelForRole(roleId);
  const resolved = getModel(modelId);
  if (!resolved || !resolved.provider.isConfigured()) {
    throw new Error("NO_API_KEY");
  }
  const toolLog: ToolCallRecord[] = [];
  const usage: TokenUsage[] = [];
  const tools = opts.withTools
    ? resolveTools({ allowedNames: narrowTools(role.allowedTools, skill?.allowedTools) })
    : undefined;
  const allowedToolNames = tools ? new Set(tools.map((t) => t.name)) : undefined;
  const content = await resolved.provider.complete({
    model: modelId,
    system: `${composeSystemPrompt(skill, role.systemPrompt)}\n\n${COUNCIL_TOOL_GUIDANCE}${opts.contextBlock}`,
    messages: [{ role: "user", content: prompt }],
    maxTokens: 3000,
    tools,
    onToolCall: opts.withTools
      ? (name, input) => executeTool(name, input, { projectId: opts.projectId, allowedToolNames })
      : undefined,
    toolLog,
    usage,
    reasoningEffort: reasoningEffortForRole(roleId),
  });
  recordUsage({
    projectId: opts.projectId,
    source: "council",
    sourceId: opts.runId,
    provider: resolved.provider.id as "anthropic" | "openrouter" | "chutes",
    model: modelId,
    role: roleId,
    usage,
  });
  return { content, modelId, toolCalls: toolLog };
}

function extractSection(text: string, label: string): string | null {
  const re = new RegExp(`${label}\\s*:?\\s*([\\s\\S]*?)(?:\\n\\s*\\n[A-Z][a-zA-Z ]*:|$)`, "i");
  const m = text.match(re);
  return m ? m[1].trim() : null;
}

// Shared by all three modes — every synthesizer prompt (independent analysis,
// debate, red team) is instructed to use this exact three-part structure.
function parseSynthesis(raw: string): { consensus: string; disagreement: string; synthesis: string } {
  return {
    consensus: extractSection(raw, "Consensus") ?? "Unspecified",
    disagreement: extractSection(raw, "Key disagreement") ?? "None recorded",
    synthesis: extractSection(raw, "Synthesis") ?? raw,
  };
}

interface PipelineOpts {
  runId: string;
  question: string;
  roles: CouncilRole[];
  projectId?: string | null;
  contextBlock: string;
}

async function runIndependentAnalysis(opts: PipelineOpts) {
  const transcript: CouncilTranscriptEntry[] = [];

  // Stage 1: independent analysis, in parallel — each role has not seen the others yet.
  const analysisPrompt = `Question put to the Magi Council:\n\n${opts.question}\n\nGive your independent analysis. Be concise but substantive.`;
  const analyses = await Promise.all(
    opts.roles.map(async (role) => {
      const { content, modelId, toolCalls } = await completeAs(role, analysisPrompt, {
        withTools: true,
        projectId: opts.projectId,
        runId: opts.runId,
        contextBlock: opts.contextBlock,
      });
      return { role, modelId, content, toolCalls };
    })
  );
  for (const a of analyses) {
    transcript.push({
      role: a.role.name,
      modelRole: a.role.modelRole,
      modelId: a.modelId,
      stage: "analysis",
      content: a.content,
      toolCalls: a.toolCalls,
    });
  }
  updateCouncilRun(opts.runId, { transcript, status: "running" });

  // Stage 2: critique — each role reads the others' analyses and responds.
  const critiquePrompt = (own: (typeof analyses)[number]) => {
    const others = analyses
      .filter((a) => a.role.name !== own.role.name)
      .map((a) => `${a.role.name}:\n${a.content}`)
      .join("\n\n");
    return `Question: ${opts.question}\n\nYour own earlier analysis:\n${own.content}\n\nOther Council members' analyses:\n\n${others}\n\nCritique the other analyses. Note where you agree, where you disagree, and why. Be specific.`;
  };
  const critiques = await Promise.all(
    analyses.map(async (a) => {
      const { content, modelId } = await completeAs(a.role, critiquePrompt(a), {
        projectId: opts.projectId,
        runId: opts.runId,
        contextBlock: opts.contextBlock,
      });
      return { role: a.role, modelId, content };
    })
  );
  for (const c of critiques) {
    transcript.push({ role: c.role.name, modelRole: c.role.modelRole, modelId: c.modelId, stage: "critique", content: c.content });
  }
  updateCouncilRun(opts.runId, { transcript, status: "running" });

  // Stage 3: synthesis — reconcile, and explicitly preserve disagreement rather than papering over it.
  const synthesisRole: CouncilRole = {
    name: "Synthesizer",
    modelRole: "synthesizer",
    systemPrompt:
      "You are the Synthesizer for a Magi Council. Reconcile the Council's analyses and critiques into a final answer. Do not silently resolve genuine disagreement — surface it. Structure your response with exactly these labeled sections: 'Consensus: <Strong|Moderate|Weak|None>', 'Key disagreement: <one paragraph, or \"None\" if the Council agreed>', and 'Synthesis: <the final answer>'.",
  };
  const allWork = [...analyses.map((a) => `${a.role.name} (analysis):\n${a.content}`), ...critiques.map((c) => `${c.role.name} (critique):\n${c.content}`)].join("\n\n");
  const synthesisPrompt = `Question: ${opts.question}\n\nFull Council record:\n\n${allWork}`;
  const { content: synthesisRaw, modelId: synthModel } = await completeAs(synthesisRole, synthesisPrompt, {
    projectId: opts.projectId,
    runId: opts.runId,
    contextBlock: opts.contextBlock,
  });
  transcript.push({ role: "Synthesizer", modelRole: "synthesizer", modelId: synthModel, stage: "synthesis", content: synthesisRaw });

  const { consensus, disagreement, synthesis } = parseSynthesis(synthesisRaw);
  updateCouncilRun(opts.runId, { transcript, consensus, disagreement, synthesis, status: "complete" });
}

// "Models argue opposing positions" (Product Vision §42) — pairwise only.
// Generalizing to N-way debate is real, separate complexity the vision text
// doesn't imply; role-count validation happens one layer up, in the API
// route, but this defensive check stays as a second line of defense in case
// runDebate is ever called from somewhere that skipped it.
async function runDebate(opts: PipelineOpts) {
  if (opts.roles.length !== 2) throw new Error("Debate mode needs exactly 2 roles.");
  const [sideA, sideB] = opts.roles;
  const transcript: CouncilTranscriptEntry[] = [];

  // Round 1: opening — both sides state their position independently.
  const openingPrompt = (own: CouncilRole) =>
    `Question put to the Magi Council, in Debate mode:\n\n${opts.question}\n\nYou are arguing one side of this question as ${own.name}. State your position clearly and make your strongest case. Be concise but substantive.`;
  const [openingA, openingB] = await Promise.all([
    completeAs(sideA, openingPrompt(sideA), { withTools: true, projectId: opts.projectId, runId: opts.runId, contextBlock: opts.contextBlock }),
    completeAs(sideB, openingPrompt(sideB), { withTools: true, projectId: opts.projectId, runId: opts.runId, contextBlock: opts.contextBlock }),
  ]);
  transcript.push(
    { role: sideA.name, modelRole: sideA.modelRole, modelId: openingA.modelId, stage: "opening", content: openingA.content, toolCalls: openingA.toolCalls },
    { role: sideB.name, modelRole: sideB.modelRole, modelId: openingB.modelId, stage: "opening", content: openingB.content, toolCalls: openingB.toolCalls }
  );
  updateCouncilRun(opts.runId, { transcript, status: "running" });

  // Round 2: rebuttal — each side responds directly to the other's opening.
  // One round, not unbounded — matches the existing pipeline's cost/latency
  // shape (3 model-call stages either way).
  const rebuttalPrompt = (own: CouncilRole, ownOpening: string, opponent: CouncilRole, opponentOpening: string) =>
    `Question: ${opts.question}\n\nYour opening position:\n${ownOpening}\n\n${opponent.name}'s opening position:\n${opponentOpening}\n\nRespond directly to ${opponent.name}'s argument. Defend your position and challenge theirs where it's weak. Engage with what they actually said, not a generic restatement.`;
  const [rebuttalA, rebuttalB] = await Promise.all([
    completeAs(sideA, rebuttalPrompt(sideA, openingA.content, sideB, openingB.content), { projectId: opts.projectId, runId: opts.runId, contextBlock: opts.contextBlock }),
    completeAs(sideB, rebuttalPrompt(sideB, openingB.content, sideA, openingA.content), { projectId: opts.projectId, runId: opts.runId, contextBlock: opts.contextBlock }),
  ]);
  transcript.push(
    { role: sideA.name, modelRole: sideA.modelRole, modelId: rebuttalA.modelId, stage: "rebuttal", content: rebuttalA.content },
    { role: sideB.name, modelRole: sideB.modelRole, modelId: rebuttalB.modelId, stage: "rebuttal", content: rebuttalB.content }
  );
  updateCouncilRun(opts.runId, { transcript, status: "running" });

  // Synthesis — never declares a winner (Product Vision §44: don't
  // automatically collapse disagreement). Characterizes what kind of
  // disagreement it actually is instead.
  const synthesisRole: CouncilRole = {
    name: "Synthesizer",
    modelRole: "synthesizer",
    systemPrompt:
      "You are the Synthesizer for a Magi Council Debate. Your job is not to declare a winner — it's to characterize the disagreement honestly. Structure your response with exactly these labeled sections: 'Consensus: <Strong|Moderate|Weak|None>', 'Key disagreement: <what the disagreement actually turns on — a factual dispute, a difference in values or priorities, or missing information — one paragraph, or \"None\" if they ultimately agreed>', and 'Synthesis: <the strongest form of each side's case, and what it would take to resolve the disagreement>'.",
  };
  const record = [
    `${sideA.name} (opening):\n${openingA.content}`,
    `${sideB.name} (opening):\n${openingB.content}`,
    `${sideA.name} (rebuttal):\n${rebuttalA.content}`,
    `${sideB.name} (rebuttal):\n${rebuttalB.content}`,
  ].join("\n\n");
  const synthesisPrompt = `Question: ${opts.question}\n\nFull debate record:\n\n${record}`;
  const { content: synthesisRaw, modelId: synthModel } = await completeAs(synthesisRole, synthesisPrompt, {
    projectId: opts.projectId,
    runId: opts.runId,
    contextBlock: opts.contextBlock,
  });
  transcript.push({ role: "Synthesizer", modelRole: "synthesizer", modelId: synthModel, stage: "synthesis", content: synthesisRaw });

  const { consensus, disagreement, synthesis } = parseSynthesis(synthesisRaw);
  updateCouncilRun(opts.runId, { transcript, consensus, disagreement, synthesis, status: "complete" });
}

// "A model attacks the argument" (Product Vision §42) — role 1 proposes,
// every role after it attacks independently. Generalizes naturally to more
// than one attacker, unlike Debate.
async function runRedTeam(opts: PipelineOpts) {
  if (opts.roles.length < 2) throw new Error("Red Team mode needs at least 2 roles.");
  const [proposer, ...attackers] = opts.roles;
  const transcript: CouncilTranscriptEntry[] = [];

  // Stage 1: proposal.
  const proposalPrompt = `Question put to the Magi Council:\n\n${opts.question}\n\nGive your answer. Be concise but substantive — this will be attacked, so make your actual best case, not a hedge.`;
  const proposal = await completeAs(proposer, proposalPrompt, { withTools: true, projectId: opts.projectId, runId: opts.runId, contextBlock: opts.contextBlock });
  transcript.push({ role: proposer.name, modelRole: proposer.modelRole, modelId: proposal.modelId, stage: "proposal", content: proposal.content, toolCalls: proposal.toolCalls });
  updateCouncilRun(opts.runId, { transcript, status: "running" });

  // Stage 2: attack — deliberately adversarial framing, distinct in tone
  // from the measured "critique" stage in Independent Analysis.
  const attackPrompt = `Question: ${opts.question}\n\n${proposer.name}'s proposal:\n${proposal.content}\n\nYou are red-teaming this proposal. Do not be measured or diplomatic — actively try to break it. Find the strongest possible objections: wrong assumptions, missing edge cases, logical gaps, or ways it fails in practice. Be specific and concrete, not generic skepticism.`;
  const attacks = await Promise.all(
    attackers.map(async (role) => {
      const { content, modelId, toolCalls } = await completeAs(role, attackPrompt, {
        withTools: true,
        projectId: opts.projectId,
        runId: opts.runId,
        contextBlock: opts.contextBlock,
      });
      return { role, modelId, content, toolCalls };
    })
  );
  for (const a of attacks) {
    transcript.push({ role: a.role.name, modelRole: a.role.modelRole, modelId: a.modelId, stage: "attack", content: a.content, toolCalls: a.toolCalls });
  }
  updateCouncilRun(opts.runId, { transcript, status: "running" });

  // Stage 3: defense — the proposer responds to the consolidated attacks.
  const attacksText = attacks.map((a) => `${a.role.name}:\n${a.content}`).join("\n\n");
  const defensePrompt = `Question: ${opts.question}\n\nYour original proposal:\n${proposal.content}\n\nRed Team attacks:\n\n${attacksText}\n\nRespond to these attacks directly. Concede points that land, defend where the attacks miss, and revise your position where warranted. Be honest, not defensive for its own sake.`;
  const defense = await completeAs(proposer, defensePrompt, { projectId: opts.projectId, runId: opts.runId, contextBlock: opts.contextBlock });
  transcript.push({ role: proposer.name, modelRole: proposer.modelRole, modelId: defense.modelId, stage: "defense", content: defense.content });
  updateCouncilRun(opts.runId, { transcript, status: "running" });

  // Synthesis — assesses which attacks actually landed, never "attacker
  // wins" / "proposer wins".
  const synthesisRole: CouncilRole = {
    name: "Synthesizer",
    modelRole: "synthesizer",
    systemPrompt:
      "You are the Synthesizer for a Magi Council Red Team exercise. Assess which attacks actually landed and which didn't, based on the defense. Structure your response with exactly these labeled sections: 'Consensus: <Strong|Moderate|Weak|None>' (how much of the original proposal survived intact), 'Key disagreement: <the attacks that were not fully resolved by the defense, or \"None\" if the defense fully answered them>', and 'Synthesis: <the strengthened final position, incorporating what held up and what had to be revised>'.",
  };
  const fullRecord = [
    `${proposer.name} (proposal):\n${proposal.content}`,
    ...attacks.map((a) => `${a.role.name} (attack):\n${a.content}`),
    `${proposer.name} (defense):\n${defense.content}`,
  ].join("\n\n");
  const synthesisPrompt = `Question: ${opts.question}\n\nFull Red Team record:\n\n${fullRecord}`;
  const { content: synthesisRaw, modelId: synthModel } = await completeAs(synthesisRole, synthesisPrompt, {
    projectId: opts.projectId,
    runId: opts.runId,
    contextBlock: opts.contextBlock,
  });
  transcript.push({ role: "Synthesizer", modelRole: "synthesizer", modelId: synthModel, stage: "synthesis", content: synthesisRaw });

  const { consensus, disagreement, synthesis } = parseSynthesis(synthesisRaw);
  updateCouncilRun(opts.runId, { transcript, consensus, disagreement, synthesis, status: "complete" });
}

export async function runCouncilDeliberation(opts: {
  runId: string;
  question: string;
  roles: CouncilRole[];
  projectId?: string | null;
  mode?: CouncilMode;
  attachments?: RunAttachment[];
}) {
  const contextBlock = buildContextBlock(opts.projectId, opts.attachments ?? []);
  const pipelineOpts: PipelineOpts = { ...opts, contextBlock };

  try {
    const mode = opts.mode ?? "independent";
    if (mode === "debate") await runDebate(pipelineOpts);
    else if (mode === "redTeam") await runRedTeam(pipelineOpts);
    else await runIndependentAnalysis(pipelineOpts);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    updateCouncilRun(opts.runId, {
      status: "error",
      synthesis: message === "NO_API_KEY" ? "No API key configured. Add one in Settings." : `Council failed: ${message}`,
    });
  }
}
