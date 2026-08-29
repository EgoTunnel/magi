import { db, newId, nowIso } from "@/lib/db";

export interface ConnectionFinding {
  targetProjectId: string;
  targetProjectName: string;
  relevance: string;
  summary: string;
  toolCalls?: { name: string; input: unknown; result: string }[];
}

export type ConnectionRunStatus = "running" | "complete" | "error";

export interface ConnectionRun {
  id: string;
  source_project_id: string;
  target_project_id: string | null;
  status: ConnectionRunStatus;
  findings: ConnectionFinding[];
  created_at: string;
  updated_at: string;
}

interface ConnectionRunRow {
  id: string;
  source_project_id: string;
  target_project_id: string | null;
  status: ConnectionRunStatus;
  findings: string;
  created_at: string;
  updated_at: string;
}

function parse(row: ConnectionRunRow): ConnectionRun {
  return { ...row, findings: JSON.parse(row.findings) as ConnectionFinding[] };
}

export function createConnectionRun(input: {
  sourceProjectId: string;
  targetProjectId?: string | null;
}): ConnectionRun {
  const id = newId("conn");
  const ts = nowIso();
  db.prepare(
    `INSERT INTO project_connections (id, source_project_id, target_project_id, status, findings, created_at, updated_at)
     VALUES (?, ?, ?, 'running', '[]', ?, ?)`
  ).run(id, input.sourceProjectId, input.targetProjectId ?? null, ts, ts);
  return getConnectionRun(id)!;
}

export function getConnectionRun(id: string): ConnectionRun | null {
  const row = db.prepare(`SELECT * FROM project_connections WHERE id = ?`).get(id) as
    | ConnectionRunRow
    | undefined;
  return row ? parse(row) : null;
}

export function listConnectionRuns(opts: { projectId?: string } = {}): ConnectionRun[] {
  const rows = opts.projectId
    ? (db
        .prepare(`SELECT * FROM project_connections WHERE source_project_id = ? ORDER BY created_at DESC`)
        .all(opts.projectId) as ConnectionRunRow[])
    : (db.prepare(`SELECT * FROM project_connections ORDER BY created_at DESC`).all() as ConnectionRunRow[]);
  return rows.map(parse);
}

export function appendConnectionFinding(id: string, finding: ConnectionFinding): ConnectionRun | null {
  const run = getConnectionRun(id);
  if (!run) return null;
  const findings = [...run.findings, finding];
  db.prepare(`UPDATE project_connections SET findings = ?, updated_at = ? WHERE id = ?`).run(
    JSON.stringify(findings),
    nowIso(),
    id
  );
  return getConnectionRun(id);
}

export function setConnectionStatus(id: string, status: ConnectionRunStatus) {
  db.prepare(`UPDATE project_connections SET status = ?, updated_at = ? WHERE id = ?`).run(
    status,
    nowIso(),
    id
  );
}
