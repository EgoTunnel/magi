import { db, newId, nowIso } from "@/lib/db";

// One person's answer to "might they be interested in this work?" — with the
// evidence, because a finding the user cannot check is a claim about a third
// party that they have no way to disagree with.
export interface PersonInterestFinding {
  personId: string;
  personName: string;
  relationship: string | null;
  // Strong | Moderate | Weak | None — the model's own word, kept as written.
  relevance: string;
  summary: string;
  // Whether they are already on this Project. A finding about someone already
  // here is still useful ("this is why they'd care about the new direction"),
  // but it is a different kind of answer than surfacing someone forgotten.
  alreadyOnProject: boolean;
  toolCalls?: { name: string; input: unknown; result: string }[];
}

export type PeopleInterestRunStatus = "running" | "complete" | "error";

export interface PeopleInterestRun {
  id: string;
  project_id: string;
  status: PeopleInterestRunStatus;
  findings: PersonInterestFinding[];
  created_at: string;
  updated_at: string;
}

interface RunRow {
  id: string;
  project_id: string;
  status: PeopleInterestRunStatus;
  findings: string;
  created_at: string;
  updated_at: string;
}

function parse(row: RunRow): PeopleInterestRun {
  return { ...row, findings: JSON.parse(row.findings) as PersonInterestFinding[] };
}

export function createPeopleInterestRun(projectId: string): PeopleInterestRun {
  const id = newId("pint");
  const ts = nowIso();
  db.prepare(
    `INSERT INTO people_interest_runs (id, project_id, status, findings, created_at, updated_at)
     VALUES (?, ?, 'running', '[]', ?, ?)`
  ).run(id, projectId, ts, ts);
  return getPeopleInterestRun(id)!;
}

export function getPeopleInterestRun(id: string): PeopleInterestRun | null {
  const row = db.prepare(`SELECT * FROM people_interest_runs WHERE id = ?`).get(id) as RunRow | undefined;
  return row ? parse(row) : null;
}

export function listPeopleInterestRuns(projectId: string): PeopleInterestRun[] {
  return (
    db
      .prepare(`SELECT * FROM people_interest_runs WHERE project_id = ? ORDER BY created_at DESC`)
      .all(projectId) as RunRow[]
  ).map(parse);
}

export function appendPersonInterestFinding(
  id: string,
  finding: PersonInterestFinding
): PeopleInterestRun | null {
  const run = getPeopleInterestRun(id);
  if (!run) return null;
  db.prepare(`UPDATE people_interest_runs SET findings = ?, updated_at = ? WHERE id = ?`).run(
    JSON.stringify([...run.findings, finding]),
    nowIso(),
    id
  );
  return getPeopleInterestRun(id);
}

export function setPeopleInterestStatus(id: string, status: PeopleInterestRunStatus) {
  db.prepare(`UPDATE people_interest_runs SET status = ?, updated_at = ? WHERE id = ?`).run(status, nowIso(), id);
}
