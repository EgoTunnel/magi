import { getModel, modelForRole } from "@/lib/models/registry";
import type { ToolCallRecord } from "@/lib/models/types";
import { ROLE_REASONING_EFFORT } from "@/lib/models/types";
import { TOOL_SPECS, executeTool } from "@/lib/tools/registry";
import { getProject, listProjects, type Project } from "@/lib/repo/projects";
import { listMemory } from "@/lib/repo/memory";
import {
  appendConnectionFinding,
  setConnectionStatus,
  type ConnectionFinding,
} from "@/lib/repo/connections";

const CONNECTION_SYSTEM_PROMPT =
  "You are helping the user discover genuine intellectual connections between two of their Magi " +
  "Projects. This is deliberate, user-initiated cross-Project research — not automatic memory bleed, " +
  "and the Projects stay separate either way. Investigate the target Project honestly using " +
  "search_archive (it defaults to searching the target Project) before concluding anything. Do not " +
  "invent connections that aren't there — if nothing substantive connects the two, say so plainly " +
  "rather than manufacturing a tenuous link. Structure your response with exactly these two labeled " +
  "sections: 'Relevance: <Strong|Moderate|Weak|None>' and 'Connections: <specific, cited findings, or " +
  "\"Nothing substantive found.\" if genuinely nothing connects>'.";

function projectSummary(project: Project): string {
  const memory = listMemory({ projectId: project.id })
    .filter((m) => m.scope === "project" && m.status === "established")
    .map((m) => `- ${m.content}`)
    .join("\n");
  const parts = [`Project: ${project.name}`];
  if (project.tagline) parts.push(`Tagline: ${project.tagline}`);
  if (project.purpose) parts.push(`Purpose: ${project.purpose}`);
  if (project.instructions) parts.push(`Instructions: ${project.instructions}`);
  if (memory) parts.push(`Established Project memory:\n${memory}`);
  return parts.join("\n");
}

function extractSection(text: string, label: string): string | null {
  const re = new RegExp(`${label}\\s*:?\\s*([\\s\\S]*?)(?:\\n\\s*\\n[A-Z][a-zA-Z ]*:|$)`, "i");
  const m = text.match(re);
  return m ? m[1].trim() : null;
}

async function analyzeTarget(source: Project, target: Project): Promise<ConnectionFinding> {
  const modelRole = "researcher";
  const modelId = modelForRole(modelRole);
  const resolved = getModel(modelId);
  if (!resolved || !resolved.provider.isConfigured()) throw new Error("NO_API_KEY");

  const toolLog: ToolCallRecord[] = [];
  const prompt = `Source Project (where the user is currently working):\n${projectSummary(source)}\n\nCandidate target Project:\n${projectSummary(target)}\n\nWhat in the target Project might be relevant to the source Project? Investigate the target Project's archive as needed before answering.`;

  const raw = await resolved.provider.complete({
    model: modelId,
    system: CONNECTION_SYSTEM_PROMPT,
    messages: [{ role: "user", content: prompt }],
    maxTokens: 1800,
    tools: TOOL_SPECS,
    onToolCall: (name, input) => executeTool(name, input, { projectId: target.id }),
    toolLog,
    reasoningEffort: ROLE_REASONING_EFFORT[modelRole],
  });

  return {
    targetProjectId: target.id,
    targetProjectName: target.name,
    relevance: extractSection(raw, "Relevance") ?? "Unspecified",
    summary: extractSection(raw, "Connections") ?? raw,
    toolCalls: toolLog,
  };
}

export async function runConnectionDiscovery(opts: {
  runId: string;
  sourceProjectId: string;
  targetProjectId?: string | null;
}) {
  const { runId, sourceProjectId, targetProjectId } = opts;
  const source = getProject(sourceProjectId);
  if (!source) {
    setConnectionStatus(runId, "error");
    return;
  }

  const targets = targetProjectId
    ? [getProject(targetProjectId)].filter((p): p is NonNullable<typeof p> => !!p)
    : listProjects().filter((p) => p.id !== sourceProjectId);

  try {
    for (const target of targets) {
      const finding = await analyzeTarget(source, target);
      appendConnectionFinding(runId, finding);
    }
    setConnectionStatus(runId, "complete");
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    appendConnectionFinding(runId, {
      targetProjectId: "",
      targetProjectName: "",
      relevance: "Error",
      summary: message === "NO_API_KEY" ? "No API key configured. Add one in Settings." : `Connection discovery failed: ${message}`,
    });
    setConnectionStatus(runId, "error");
  }
}
