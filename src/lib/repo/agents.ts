import { db, newId, nowIso } from "@/lib/db";

// "stage" is what a Skill-driven pipeline produces — its steps are named by
// the Skill, not by the built-in plan/research/draft/critique/revise sequence.
export type AgentStepType =
  | "plan"
  | "research"
  | "draft"
  | "critique"
  | "revise"
  | "stage"
  | "final"
  | "error";

export interface AgentStep {
  id: string;
  type: AgentStepType;
  title: string;
  content: string;
  toolCalls?: { name: string; input: unknown; result: string }[];
  createdAt: string;
}

export type AgentRunStatus = "running" | "stopping" | "stopped" | "complete" | "error";

export interface AgentRun {
  id: string;
  project_id: string | null;
  objective: string;
  status: AgentRunStatus;
  steps: AgentStep[];
  artifact_id: string | null;
  // Null means "all globally-enabled tools" — Agents have no persistent
  // template to attach permissions to, so this is chosen once at launch.
  allowed_tools: string[] | null;
  // The Skill whose staged pipeline this run followed, if any.
  skill_id: string | null;
  created_at: string;
  updated_at: string;
}

interface AgentRunRow {
  id: string;
  project_id: string | null;
  objective: string;
  status: AgentRunStatus;
  steps: string;
  artifact_id: string | null;
  allowed_tools: string | null;
  skill_id: string | null;
  created_at: string;
  updated_at: string;
}

function parse(row: AgentRunRow): AgentRun {
  let allowed_tools: string[] | null = null;
  if (row.allowed_tools) {
    try {
      const parsed = JSON.parse(row.allowed_tools);
      if (Array.isArray(parsed)) allowed_tools = parsed;
    } catch {
      // leave null — treat unparseable data as "no restriction"
    }
  }
  return { ...row, steps: JSON.parse(row.steps) as AgentStep[], allowed_tools };
}

export function createAgentRun(input: {
  objective: string;
  projectId?: string | null;
  allowedTools?: string[] | null;
  skillId?: string | null;
}): AgentRun {
  const id = newId("agent");
  const ts = nowIso();
  db.prepare(
    `INSERT INTO agent_runs (id, project_id, objective, status, steps, allowed_tools, skill_id, created_at, updated_at)
     VALUES (?, ?, ?, 'running', '[]', ?, ?, ?, ?)`
  ).run(
    id,
    input.projectId ?? null,
    input.objective,
    input.allowedTools?.length ? JSON.stringify(input.allowedTools) : null,
    input.skillId ?? null,
    ts,
    ts
  );
  return getAgentRun(id)!;
}

export function getAgentRun(id: string): AgentRun | null {
  const row = db.prepare(`SELECT * FROM agent_runs WHERE id = ?`).get(id) as AgentRunRow | undefined;
  return row ? parse(row) : null;
}

export function listAgentRuns(opts: { projectId?: string } = {}): AgentRun[] {
  const rows = opts.projectId
    ? (db
        .prepare(`SELECT * FROM agent_runs WHERE project_id = ? ORDER BY created_at DESC`)
        .all(opts.projectId) as AgentRunRow[])
    : (db.prepare(`SELECT * FROM agent_runs ORDER BY created_at DESC`).all() as AgentRunRow[]);
  return rows.map(parse);
}

export function appendAgentStep(id: string, step: Omit<AgentStep, "id" | "createdAt">): AgentRun | null {
  const run = getAgentRun(id);
  if (!run) return null;
  const fullStep: AgentStep = { ...step, id: newId("step"), createdAt: nowIso() };
  const steps = [...run.steps, fullStep];
  db.prepare(`UPDATE agent_runs SET steps = ?, updated_at = ? WHERE id = ?`).run(
    JSON.stringify(steps),
    nowIso(),
    id
  );
  return getAgentRun(id);
}

export function setAgentStatus(id: string, status: AgentRunStatus) {
  db.prepare(`UPDATE agent_runs SET status = ?, updated_at = ? WHERE id = ?`).run(status, nowIso(), id);
}

export function setAgentArtifact(id: string, artifactId: string) {
  db.prepare(`UPDATE agent_runs SET artifact_id = ?, updated_at = ? WHERE id = ?`).run(
    artifactId,
    nowIso(),
    id
  );
}

export function isStopRequested(id: string): boolean {
  const run = getAgentRun(id);
  return run?.status === "stopping";
}
