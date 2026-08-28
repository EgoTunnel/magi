import { getModel, modelForRole } from "@/lib/models/registry";
import type { ModelRoleId, ToolCallRecord } from "@/lib/models/types";
import type { CouncilRole, CouncilTranscriptEntry } from "@/lib/repo/councils";
import { updateCouncilRun } from "@/lib/repo/councils";
import { getProject } from "@/lib/repo/projects";
import { TOOL_SPECS, executeTool } from "@/lib/tools/registry";

async function completeAs(
  role: CouncilRole,
  prompt: string,
  opts: { withTools?: boolean; projectId?: string | null } = {}
): Promise<{ content: string; modelId: string; toolCalls: ToolCallRecord[] }> {
  const modelId = modelForRole((role.modelRole as ModelRoleId) ?? "default");
  const resolved = getModel(modelId);
  if (!resolved || !resolved.provider.isConfigured()) {
    throw new Error("NO_API_KEY");
  }
  const toolLog: ToolCallRecord[] = [];
  const content = await resolved.provider.complete({
    model: modelId,
    system: role.systemPrompt,
    messages: [{ role: "user", content: prompt }],
    maxTokens: 3000,
    tools: opts.withTools ? TOOL_SPECS : undefined,
    onToolCall: opts.withTools ? (name, input) => executeTool(name, input, { projectId: opts.projectId }) : undefined,
    toolLog,
  });
  return { content, modelId, toolCalls: toolLog };
}

function extractSection(text: string, label: string): string | null {
  const re = new RegExp(`${label}\\s*:?\\s*([\\s\\S]*?)(?:\\n\\s*\\n[A-Z][a-zA-Z ]*:|$)`, "i");
  const m = text.match(re);
  return m ? m[1].trim() : null;
}

export async function runCouncilDeliberation(opts: {
  runId: string;
  question: string;
  roles: CouncilRole[];
  projectId?: string | null;
}) {
  const transcript: CouncilTranscriptEntry[] = [];
  const project = opts.projectId ? getProject(opts.projectId) : null;
  const projectContext = project
    ? `\n\nProject context — "${project.name}"${project.purpose ? `: ${project.purpose}` : ""}${
        project.instructions ? `\nProject instructions: ${project.instructions}` : ""
      }`
    : "";

  try {
    // Stage 1: independent analysis, in parallel — each role has not seen the others yet.
    const analysisPrompt = `Question put to the Magi Council:\n\n${opts.question}${projectContext}\n\nGive your independent analysis. Be concise but substantive.`;
    const analyses = await Promise.all(
      opts.roles.map(async (role) => {
        const { content, modelId, toolCalls } = await completeAs(role, analysisPrompt, {
          withTools: true,
          projectId: opts.projectId,
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
        const { content, modelId } = await completeAs(a.role, critiquePrompt(a));
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
    const synthesisPrompt = `Question: ${opts.question}${projectContext}\n\nFull Council record:\n\n${allWork}`;
    const { content: synthesisRaw, modelId: synthModel } = await completeAs(synthesisRole, synthesisPrompt);
    transcript.push({ role: "Synthesizer", modelRole: "synthesizer", modelId: synthModel, stage: "synthesis", content: synthesisRaw });

    const consensus = extractSection(synthesisRaw, "Consensus") ?? "Unspecified";
    const disagreement = extractSection(synthesisRaw, "Key disagreement") ?? "None recorded";
    const synthesis = extractSection(synthesisRaw, "Synthesis") ?? synthesisRaw;

    updateCouncilRun(opts.runId, { transcript, consensus, disagreement, synthesis, status: "complete" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    updateCouncilRun(opts.runId, {
      transcript,
      status: "error",
      synthesis: message === "NO_API_KEY" ? "No API key configured. Add one in Settings." : `Council failed: ${message}`,
    });
  }
}
