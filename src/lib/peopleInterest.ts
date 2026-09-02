import { getModel, modelForRole, reasoningEffortForRole } from "@/lib/models/registry";
import type { TokenUsage, ToolCallRecord } from "@/lib/models/types";
import { resolveTools, executeTool } from "@/lib/tools/registry";
import { getProject, type Project } from "@/lib/repo/projects";
import { listMemory } from "@/lib/repo/memory";
import { recordUsage } from "@/lib/repo/usage";
import { listPeople, listPersonMentions, listProjectsForPerson, type Person } from "@/lib/repo/people";
import {
  appendPersonInterestFinding,
  setPeopleInterestStatus,
  type PersonInterestFinding,
} from "@/lib/repo/peopleInterest";

// The payoff the People feature was built toward: "you're working on X — you
// talked to someone last spring who cares about exactly this." Only possible
// because passages are dated, retrievable, and attributed.
//
// The discipline is inherited from cross-Project Connections, and it matters
// more here: a manufactured link between two Projects wastes a minute, while a
// manufactured claim about a *person* is something the user might act on with
// that person. "Nobody obviously" has to be an acceptable answer, and the
// prompt says so twice.
const INTEREST_SYSTEM_PROMPT =
  "You are helping the user work out which of the people they know might genuinely care about a piece " +
  "of their work. This is a judgement about relevance, not a suggestion to contact anyone.\n\n" +
  "You are given one Project and one person. Decide whether what the user knows about that person — " +
  "their role, their recorded interests, and where they appear in the archive — genuinely connects to " +
  "this Project's subject matter. Use search_archive to check the Project's own material before " +
  "concluding anything, and ground every claim in something you actually found.\n\n" +
  "Do not manufacture a connection. Most people will have no real link to most Projects, and saying so " +
  "is the correct and expected answer — a weak, generic link ('they work in the same industry', 'both " +
  "involve strategy') is worse than none, because the user may act on it. Never infer anything about " +
  "the person beyond what you were given: you know what the user recorded and what the archive says, " +
  "and nothing else about their life, opinions, or availability.\n\n" +
  "Reply with exactly these two labeled sections:\n" +
  "Relevance: <Strong|Moderate|Weak|None>\n" +
  "Why: <the specific connection and the evidence for it, naming what you found; or " +
  "\"No real connection.\" if there is genuinely none>";

// Each person costs a model call, so this is bounded the way the roster block
// is. Established people only — a suggested person is inert everywhere.
const MAX_PEOPLE = 24;

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

// Everything known about the person, and nothing more — established facts, and
// real dated passages that mention them. The mentions are what let a finding
// cite evidence instead of asserting a vibe.
async function personSummary(person: Person): Promise<string> {
  const facts = listMemory({ personId: person.id })
    .filter((f) => f.status === "established")
    .map((f) => `- (${f.created_at.slice(0, 10)}) ${f.content}`)
    .join("\n");
  const mentions = (await listPersonMentions(person, 6).catch(() => []))
    .map((m) => `- (${m.sourceDate.slice(0, 10)}) ${m.title}: ${m.content.replace(/\s+/g, " ").slice(0, 300)}`)
    .join("\n");

  const parts = [`Person: ${person.name}`];
  if (person.relationship) parts.push(`Relationship to the user: ${person.relationship}`);
  if (person.summary) parts.push(`Summary: ${person.summary}`);
  parts.push(facts ? `What the user has recorded about them:\n${facts}` : "The user has recorded no facts about them.");
  parts.push(
    mentions
      ? `Where they appear in the archive:\n${mentions}`
      : "They do not appear anywhere in the archive."
  );
  return parts.join("\n");
}

function extractSection(text: string, label: string): string | null {
  const re = new RegExp(`${label}\\s*:?\\s*([\\s\\S]*?)(?:\\n\\s*\\n[A-Z][a-zA-Z ]*:|$)`, "i");
  const m = text.match(re);
  return m ? m[1].trim() : null;
}

async function assess(
  project: Project,
  person: Person,
  alreadyOnProject: boolean,
  runId: string
): Promise<PersonInterestFinding> {
  const modelRole = "researcher";
  const modelId = modelForRole(modelRole);
  const resolved = getModel(modelId);
  if (!resolved || !resolved.provider.isConfigured()) throw new Error("NO_API_KEY");

  const toolLog: ToolCallRecord[] = [];
  const usage: TokenUsage[] = [];
  const tools = resolveTools();
  const allowedToolNames = new Set(tools.map((t) => t.name));

  const raw = await resolved.provider.complete({
    model: modelId,
    system: INTEREST_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content:
          `The work:\n${projectSummary(project)}\n\n${await personSummary(person)}\n\n` +
          `Would ${person.name} genuinely care about this work, and why? Check the Project's material ` +
          `before answering.`,
      },
    ],
    maxTokens: 1200,
    tools,
    onToolCall: (name, input) => executeTool(name, input, { projectId: project.id, allowedToolNames }),
    toolLog,
    usage,
    reasoningEffort: reasoningEffortForRole(modelRole),
  });
  recordUsage({
    projectId: project.id,
    source: "people_interest",
    sourceId: runId,
    provider: resolved.provider.id as "anthropic" | "openrouter",
    model: modelId,
    role: modelRole,
    usage,
  });

  return {
    personId: person.id,
    personName: person.name,
    relationship: person.relationship,
    relevance: extractSection(raw, "Relevance") ?? "Unspecified",
    summary: extractSection(raw, "Why") ?? raw,
    alreadyOnProject,
    toolCalls: toolLog,
  };
}

export async function runPeopleInterestDiscovery(opts: { runId: string; projectId: string }) {
  const { runId, projectId } = opts;
  const project = getProject(projectId);
  if (!project) {
    setPeopleInterestStatus(runId, "error");
    return;
  }

  const people = listPeople({ status: "established" }).slice(0, MAX_PEOPLE);
  const onProject = new Set(
    people
      .filter((p) => listProjectsForPerson(p.id).some((x) => x.id === projectId && x.status === "established"))
      .map((p) => p.id)
  );

  try {
    for (const person of people) {
      appendPersonInterestFinding(runId, await assess(project, person, onProject.has(person.id), runId));
    }
    setPeopleInterestStatus(runId, "complete");
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    appendPersonInterestFinding(runId, {
      personId: "",
      personName: "",
      relationship: null,
      relevance: "Error",
      summary:
        message === "NO_API_KEY"
          ? "No API key configured. Add one in Settings."
          : `Could not finish: ${message}`,
      alreadyOnProject: false,
    });
    setPeopleInterestStatus(runId, "error");
  }
}
