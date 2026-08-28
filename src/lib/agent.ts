import { getModel, modelForRole } from "@/lib/models/registry";
import type { ModelRoleId, ToolCallRecord } from "@/lib/models/types";
import { TOOL_SPECS, executeTool } from "@/lib/tools/registry";
import { getProject } from "@/lib/repo/projects";
import { createArtifact } from "@/lib/repo/artifacts";
import {
  appendAgentStep,
  isStopRequested,
  setAgentArtifact,
  setAgentStatus,
  type AgentStepType,
} from "@/lib/repo/agents";

const AGENT_BOUNDARIES =
  "You are an Agent operating inside Magi, pursuing a single objective on the user's behalf. " +
  "You can search Magi's archive and use a calculator; you cannot send messages, modify files, browse the " +
  "web, or take any action outside this task. Stay strictly on the objective. Be precise and say plainly " +
  "when evidence is thin rather than filling gaps with confident-sounding invention. Do not narrate your " +
  "plan, describe what you are about to write, or think out loud in your response — output only the " +
  "finished result itself, starting directly with its first real sentence.";

async function runStep(opts: {
  modelRole: ModelRoleId;
  system: string;
  prompt: string;
  withTools?: boolean;
  projectId?: string | null;
  maxTokens?: number;
}): Promise<{ content: string; toolCalls: ToolCallRecord[] }> {
  const modelId = modelForRole(opts.modelRole);
  const resolved = getModel(modelId);
  if (!resolved || !resolved.provider.isConfigured()) throw new Error("NO_API_KEY");
  const toolLog: ToolCallRecord[] = [];
  const content = await resolved.provider.complete({
    model: modelId,
    system: opts.system,
    messages: [{ role: "user", content: opts.prompt }],
    maxTokens: opts.maxTokens ?? 1600,
    tools: opts.withTools ? TOOL_SPECS : undefined,
    onToolCall: opts.withTools ? (name, input) => executeTool(name, input, { projectId: opts.projectId }) : undefined,
    toolLog,
  });
  return { content, toolCalls: toolLog };
}

const EMPTY_STEP_NOTE =
  "(Magi returned no text for this step — the model likely spent its whole budget on internal reasoning " +
  "without producing a visible answer. This can happen with some reasoning models under a tight token " +
  "limit. Try again, or assign a different model to this role in Settings.)";

// Steps are recorded for display with a visible placeholder when empty, but
// the *raw* content (which may be genuinely empty) is what gets threaded into
// later prompts — later steps have repeatedly shown they can sensibly react
// to "no research was found" rather than needing it papered over.
function record(runId: string, type: AgentStepType, title: string, content: string, toolCalls?: ToolCallRecord[]) {
  appendAgentStep(runId, { type, title, content: content.trim() ? content : EMPTY_STEP_NOTE, toolCalls });
}

export async function runAgent(opts: { runId: string; objective: string; projectId?: string | null }) {
  const { runId, objective, projectId } = opts;
  const project = projectId ? getProject(projectId) : null;
  const projectContext = project
    ? `\n\nThis objective belongs to the Project "${project.name}"${project.purpose ? `: ${project.purpose}` : ""}.${
        project.instructions ? `\nProject instructions: ${project.instructions}` : ""
      }`
    : "";

  function stopped(): boolean {
    if (isStopRequested(runId)) {
      record(runId, "error", "Stopped", "The user stopped this Agent before it finished.");
      setAgentStatus(runId, "stopped");
      return true;
    }
    return false;
  }

  try {
    // 1. Plan
    const plan = await runStep({
      modelRole: "reasoner",
      system: `${AGENT_BOUNDARIES} You are planning, not yet executing. Break the objective into 2-4 concrete questions that need answers.`,
      prompt: `Objective: ${objective}${projectContext}\n\nList the key questions to investigate, most important first. Be concrete.`,
      maxTokens: 3000,
    });
    record(runId, "plan", "Plan", plan.content);
    if (stopped()) return;

    // 2. Research — the only step with tool access, since it's the one that needs to look things up.
    const research = await runStep({
      modelRole: "researcher",
      system: `${AGENT_BOUNDARIES} You are researching. Use search_archive where it could plausibly hold relevant material; use calculator for any real computation. Report findings plainly, including where you found nothing.`,
      prompt: `Objective: ${objective}${projectContext}\n\nResearch plan:\n${plan.content}\n\nInvestigate and report what you find.`,
      withTools: true,
      projectId,
      maxTokens: 4000,
    });
    record(runId, "research", "Research", research.content, research.toolCalls);
    if (stopped()) return;

    // 3. Draft
    const draft = await runStep({
      modelRole: "writer",
      system: `${AGENT_BOUNDARIES} Write a clear, substantive draft addressing the objective directly, grounded in the research below. Editorial clarity, no filler.`,
      prompt: `Objective: ${objective}${projectContext}\n\nResearch findings:\n${research.content}\n\nWrite the draft now. Begin immediately with its first sentence.`,
      maxTokens: 5000,
    });
    record(runId, "draft", "Draft", draft.content);
    if (stopped()) return;

    // 4. Critique
    const critique = await runStep({
      modelRole: "critic",
      system: `${AGENT_BOUNDARIES} You are the critic. Be genuinely skeptical: gaps in evidence, unsupported claims, unclear structure, anything that doesn't actually serve the objective.`,
      prompt: `Objective: ${objective}\n\nDraft:\n${draft.content}\n\nCritique it.`,
      maxTokens: 2200,
    });
    record(runId, "critique", "Critique", critique.content);
    if (stopped()) return;

    // 5. Revise
    const revised = await runStep({
      modelRole: "writer",
      system: `${AGENT_BOUNDARIES} Revise the draft in light of the critique. Produce the final version only — no meta-commentary about what changed.`,
      prompt: `Objective: ${objective}\n\nDraft:\n${draft.content}\n\nCritique:\n${critique.content}\n\nWrite the final, revised version. Begin immediately with its first sentence — do not restate the task or describe your approach first.`,
      maxTokens: 5000,
    });
    record(runId, "revise", "Final", revised.content);

    // 6. Save as an artifact, if this Agent belongs to a Project. Fall back through
    // earlier stages rather than ever persisting an empty artifact.
    const finalContent = [revised.content, draft.content, research.content].find((c) => c.trim());
    if (projectId && finalContent) {
      const artifact = createArtifact({
        projectId,
        title: objective.slice(0, 80),
        type: "agent-report",
        content: finalContent,
      });
      setAgentArtifact(runId, artifact.id);
    }

    record(
      runId,
      "final",
      "Complete",
      finalContent ? "The Agent finished its objective." : "The Agent finished, but never produced usable text to save as an artifact."
    );
    setAgentStatus(runId, "complete");
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    record(
      runId,
      "error",
      "Error",
      message === "NO_API_KEY" ? "No API key configured. Add one in Settings." : `Agent failed: ${message}`
    );
    setAgentStatus(runId, "error");
  }
}
