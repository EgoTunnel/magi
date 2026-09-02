import { db, newId, nowIso } from "@/lib/db";

export interface CouncilRole {
  name: string;
  systemPrompt: string;
  modelRole: string; // references a MODEL_ROLES id, e.g. "reasoner", "critic"
  // Which tools this role may be offered, narrowing past whatever's globally
  // enabled in Settings — same convention as Skill.allowed_tools and Agent
  // run allowedTools (see resolveTools() in src/lib/tools/registry.ts).
  // null/absent means no restriction.
  allowedTools?: string[] | null;
}

export interface RunAttachment {
  filename: string;
  extractedText: string;
}

export interface Council {
  id: string;
  scope: "global" | "project";
  project_id: string | null;
  name: string;
  description: string | null;
  roles: CouncilRole[];
  created_at: string;
}

interface CouncilRow {
  id: string;
  scope: "global" | "project";
  project_id: string | null;
  name: string;
  description: string | null;
  roles: string;
  created_at: string;
}

function parse(row: CouncilRow): Council {
  return { ...row, roles: JSON.parse(row.roles) as CouncilRole[] };
}

export function listCouncils(opts: { projectId?: string } = {}): Council[] {
  const rows = opts.projectId
    ? (db
        .prepare(`SELECT * FROM councils WHERE scope = 'global' OR project_id = ? ORDER BY created_at DESC`)
        .all(opts.projectId) as CouncilRow[])
    : (db.prepare(`SELECT * FROM councils ORDER BY created_at DESC`).all() as CouncilRow[]);
  return rows.map(parse);
}

export function getCouncil(id: string): Council | null {
  const row = db.prepare(`SELECT * FROM councils WHERE id = ?`).get(id) as CouncilRow | undefined;
  return row ? parse(row) : null;
}

export function createCouncil(input: {
  scope: "global" | "project";
  projectId?: string;
  name: string;
  description?: string;
  roles: CouncilRole[];
}): Council {
  const id = newId("cncl");
  const ts = nowIso();
  db.prepare(
    `INSERT INTO councils (id, scope, project_id, name, description, roles, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.scope,
    input.scope === "project" ? input.projectId ?? null : null,
    input.name,
    input.description ?? null,
    JSON.stringify(input.roles),
    ts
  );
  return getCouncil(id)!;
}

export function deleteCouncil(id: string) {
  db.prepare(`DELETE FROM councils WHERE id = ?`).run(id);
}

export type CouncilMode = "independent" | "debate" | "redTeam";

export interface CouncilTranscriptEntry {
  role: string;
  modelRole: string;
  modelId: string;
  stage: "analysis" | "critique" | "synthesis" | "opening" | "rebuttal" | "proposal" | "attack" | "defense";
  content: string;
  toolCalls?: { name: string; input: unknown; result: string }[];
}

export interface CouncilRun {
  id: string;
  council_id: string | null;
  project_id: string | null;
  question: string;
  mode: CouncilMode;
  attachments: RunAttachment[];
  transcript: CouncilTranscriptEntry[];
  consensus: string | null;
  disagreement: string | null;
  synthesis: string | null;
  status: "running" | "complete" | "error";
  created_at: string;
}

interface CouncilRunRow {
  id: string;
  council_id: string | null;
  project_id: string | null;
  question: string;
  mode: CouncilMode;
  attachments: string;
  transcript: string;
  consensus: string | null;
  disagreement: string | null;
  synthesis: string | null;
  status: "running" | "complete" | "error";
  created_at: string;
}

function parseRun(row: CouncilRunRow): CouncilRun {
  return {
    ...row,
    attachments: JSON.parse(row.attachments) as RunAttachment[],
    transcript: JSON.parse(row.transcript) as CouncilTranscriptEntry[],
  };
}

export function createCouncilRun(input: {
  councilId?: string;
  projectId?: string;
  question: string;
  mode?: CouncilMode;
  attachments?: RunAttachment[];
}): CouncilRun {
  const id = newId("run");
  const ts = nowIso();
  db.prepare(
    `INSERT INTO council_runs (id, council_id, project_id, question, mode, attachments, transcript, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, '[]', 'running', ?)`
  ).run(
    id,
    input.councilId ?? null,
    input.projectId ?? null,
    input.question,
    input.mode ?? "independent",
    JSON.stringify(input.attachments ?? []),
    ts
  );
  return getCouncilRun(id)!;
}

export function getCouncilRun(id: string): CouncilRun | null {
  const row = db.prepare(`SELECT * FROM council_runs WHERE id = ?`).get(id) as CouncilRunRow | undefined;
  return row ? parseRun(row) : null;
}

export function listCouncilRuns(opts: { projectId?: string } = {}): CouncilRun[] {
  const rows = opts.projectId
    ? (db
        .prepare(`SELECT * FROM council_runs WHERE project_id = ? ORDER BY created_at DESC`)
        .all(opts.projectId) as CouncilRunRow[])
    : (db.prepare(`SELECT * FROM council_runs ORDER BY created_at DESC`).all() as CouncilRunRow[]);
  return rows.map(parseRun);
}

export function updateCouncilRun(
  id: string,
  patch: Partial<Pick<CouncilRun, "transcript" | "consensus" | "disagreement" | "synthesis" | "status">>
) {
  const existing = getCouncilRun(id);
  if (!existing) return null;
  const next = { ...existing, ...patch };
  db.prepare(
    `UPDATE council_runs SET transcript = ?, consensus = ?, disagreement = ?, synthesis = ?, status = ? WHERE id = ?`
  ).run(
    JSON.stringify(next.transcript),
    next.consensus,
    next.disagreement,
    next.synthesis,
    next.status,
    id
  );
  return getCouncilRun(id);
}
