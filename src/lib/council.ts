import { getModel, modelForRole, reasoningEffortForRole } from "@/lib/models/registry";
import type { ModelRoleId, TokenUsage, ToolCallRecord } from "@/lib/models/types";
import type { CouncilMode, CouncilRole, CouncilTranscriptEntry } from "@/lib/repo/councils";
import { updateCouncilRun } from "@/lib/repo/councils";
import { getProject } from "@/lib/repo/projects";
import { resolveTools, executeTool } from "@/lib/tools/registry";
import { recordUsage } from "@/lib/repo/usage";

async function completeAs(
  role: CouncilRole,
  prompt: string,
  opts: { withTools?: boolean; projectId?: string | null; runId: string }
): Promise<{ content: string; modelId: string; toolCalls: ToolCallRecord[] }> {
  const roleId = (role.modelRole as ModelRoleId) ?? "default";
  const modelId = modelForRole(roleId);
  const resolved = getModel(modelId);
  if (!resolved || !resolved.provider.isConfigured()) {
    throw new Error("NO_API_KEY");
  }
  const toolLog: ToolCallRecord[] = [];
  const usage: TokenUsage[] = [];
  const tools = opts.withTools ? resolveTools() : undefined;
  const allowedToolNames = tools ? new Set(tools.map((t) => t.name)) : undefined;
  const content = await resolved.provider.complete({
    model: modelId,
    system: role.systemPrompt,
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
    provider: resolved.provider.id as "anthropic" | "openrouter",
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
  projectContext: string;
}

async function runIndependentAnalysis(opts: PipelineOpts) {
  const transcript: CouncilTranscriptEntry[] = [];

  // Stage 1: independent analysis, in parallel — each role has not seen the others yet.
  const analysisPrompt = `Question put to the Magi Council:\n\n${opts.question}${opts.projectContext}\n\nGive your independent analysis. Be concise but substantive.`;
  const analyses = await Promise.all(
    opts.roles.map(async (role) => {
      const { content, modelId, toolCalls } = await completeAs(role, analysisPrompt, {
        withTools: true,
        projectId: opts.projectId,
        runId: opts.runId,
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
  const synthesisPrompt = `Question: ${opts.question}${opts.projectContext}\n\nFull Council record:\n\n${allWork}`;
  const { content: synthesisRaw, modelId: synthModel } = await completeAs(synthesisRole, synthesisPrompt, {
    projectId: opts.projectId,
    runId: opts.runId,
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
    `Question put to the Magi Council, in Debate mode:\n\n${opts.question}${opts.projectContext}\n\nYou are arguing one side of this question as ${own.name}. State your position clearly and make your strongest case. Be concise but substantive.`;
  const [openingA, openingB] = await Promise.all([
    completeAs(sideA, openingPrompt(sideA), { withTools: true, projectId: opts.projectId, runId: opts.runId }),
    completeAs(sideB, openingPrompt(sideB), { withTools: true, projectId: opts.projectId, runId: opts.runId }),
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
    completeAs(sideA, rebuttalPrompt(sideA, openingA.content, sideB, openingB.content), { projectId: opts.projectId, runId: opts.runId }),
    completeAs(sideB, rebuttalPrompt(sideB, openingB.content, sideA, openingA.content), { projectId: opts.projectId, runId: opts.runId }),
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
  const synthesisPrompt = `Question: ${opts.question}${opts.projectContext}\n\nFull debate record:\n\n${record}`;
  const { content: synthesisRaw, modelId: synthModel } = await completeAs(synthesisRole, synthesisPrompt, {
    projectId: opts.projectId,
    runId: opts.runId,
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
  const proposalPrompt = `Question put to the Magi Council:\n\n${opts.question}${opts.projectContext}\n\nGive your answer. Be concise but substantive — this will be attacked, so make your actual best case, not a hedge.`;
  const proposal = await completeAs(proposer, proposalPrompt, { withTools: true, projectId: opts.projectId, runId: opts.runId });
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
  const defense = await completeAs(proposer, defensePrompt, { projectId: opts.projectId, runId: opts.runId });
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
  const synthesisPrompt = `Question: ${opts.question}${opts.projectContext}\n\nFull Red Team record:\n\n${fullRecord}`;
  const { content: synthesisRaw, modelId: synthModel } = await completeAs(synthesisRole, synthesisPrompt, {
    projectId: opts.projectId,
    runId: opts.runId,
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
}) {
  const project = opts.projectId ? getProject(opts.projectId) : null;
  const projectContext = project
    ? `\n\nProject context — "${project.name}"${project.purpose ? `: ${project.purpose}` : ""}${
        project.instructions ? `\nProject instructions: ${project.instructions}` : ""
      }`
    : "";
  const pipelineOpts: PipelineOpts = { ...opts, projectContext };

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
