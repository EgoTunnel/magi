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
  // A Skill this member works by (Product Vision §39: Councils are groups of
  // actors, actors use Skills). The Skill supplies its method, and fills in
  // the model role and tool allowlist wherever this role leaves them unset —
  // see src/lib/skillComposition.ts for the precedence.
  skillId?: string | null;
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

export type CouncilMode = "independent" | "debate" | "redTeam" | "matrix";

export const CONSENSUS_LEVELS = ["None", "Weak", "Moderate", "Strong"] as const;
export type ConsensusLevel = (typeof CONSENSUS_LEVELS)[number];

// How a run's consensus rating was arrived at. With Jev configured it is
// measured — a typed rating over the members' own words, with a distribution
// and a confidence — and the Synthesizer's self-reported rating is kept
// alongside, because when the two differ that is itself worth seeing.
export interface ConsensusDetail {
  source: "jev" | "synthesizer";
  level: ConsensusLevel | null;
  confidence?: number;
  probabilities?: Partial<Record<ConsensusLevel, number>>;
  synthesizerSaid: ConsensusLevel | null;
}

// Decision Matrix: what was being decided between, and on what.
export interface MatrixCriterion {
  name: string;
  // 1 (minor) to 5 (critical).
  weight: number;
}

export const MATRIX_LEVELS = ["Very poor", "Poor", "Fair", "Good", "Excellent"] as const;

export interface MatrixCell {
  option: string;
  criterion: string;
  // The most likely level, and its position on MATRIX_LEVELS (0-4).
  label: string;
  level: number;
  // The level averaged over its distribution, on a 0-10 scale — what the
  // weighting uses, so an uncertain "Good" counts for less than a sure one.
  expected: number;
  confidence?: number;
  probabilities?: Record<string, number>;
}

export interface MatrixResult {
  options: string[];
  criteria: MatrixCriterion[];
  // Present once scored.
  scoredBy?: "jev" | "model";
  cells?: MatrixCell[];
  // Weighted score out of 10 per option, best first.
  totals?: Array<{ option: string; score: number }>;
  // Criteria whose removal would change which option comes first — what the
  // decision actually turns on.
  decisiveCriteria?: string[];
}

export interface CouncilTranscriptEntry {
  role: string;
  modelRole: string;
  modelId: string;
  stage:
    | "analysis"
    | "critique"
    | "synthesis"
    | "opening"
    | "rebuttal"
    | "proposal"
    | "attack"
    | "defense"
    | "assessment";
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
  consensus_detail: ConsensusDetail | null;
  matrix: MatrixResult | null;
  // Set when the Council was asked from a conversation — see
  // src/lib/councilInConversation.ts.
  conversation_id: string | null;
  source_message_id: string | null;
  result_message_id: string | null;
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
  consensus_detail: string | null;
  matrix: string | null;
  conversation_id: string | null;
  source_message_id: string | null;
  result_message_id: string | null;
  status: "running" | "complete" | "error";
  created_at: string;
}

function parseRun(row: CouncilRunRow): CouncilRun {
  return {
    ...row,
    attachments: JSON.parse(row.attachments) as RunAttachment[],
    transcript: JSON.parse(row.transcript) as CouncilTranscriptEntry[],
    consensus_detail: row.consensus_detail ? (JSON.parse(row.consensus_detail) as ConsensusDetail) : null,
    matrix: row.matrix ? (JSON.parse(row.matrix) as MatrixResult) : null,
  };
}

export function createCouncilRun(input: {
  councilId?: string;
  projectId?: string;
  question: string;
  mode?: CouncilMode;
  attachments?: RunAttachment[];
  // A Decision Matrix run's options and criteria; scored later.
  matrix?: Pick<MatrixResult, "options" | "criteria">;
  conversationId?: string;
  sourceMessageId?: string;
}): CouncilRun {
  const id = newId("run");
  const ts = nowIso();
  db.prepare(
    `INSERT INTO council_runs
       (id, council_id, project_id, question, mode, attachments, matrix, conversation_id, source_message_id, transcript, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', 'running', ?)`
  ).run(
    id,
    input.councilId ?? null,
    input.projectId ?? null,
    input.question,
    input.mode ?? "independent",
    JSON.stringify(input.attachments ?? []),
    input.matrix ? JSON.stringify(input.matrix) : null,
    input.conversationId ?? null,
    input.sourceMessageId ?? null,
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

export function setCouncilRunResultMessage(id: string, messageId: string) {
  db.prepare(`UPDATE council_runs SET result_message_id = ? WHERE id = ?`).run(messageId, id);
}

// Councils asked from this conversation whose answer hasn't reached it yet —
// still deliberating, or finished and about to be posted. What the
// conversation shows as "the Council is deliberating" cards.
export function listPendingCouncilRunsForConversation(conversationId: string): CouncilRun[] {
  const rows = db
    .prepare(
      `SELECT * FROM council_runs
       WHERE conversation_id = ? AND result_message_id IS NULL AND status != 'error'
       ORDER BY created_at ASC`
    )
    .all(conversationId) as CouncilRunRow[];
  return rows.map(parseRun);
}

export function updateCouncilRun(
  id: string,
  patch: Partial<
    Pick<CouncilRun, "transcript" | "consensus" | "disagreement" | "synthesis" | "status" | "consensus_detail" | "matrix">
  >
) {
  const existing = getCouncilRun(id);
  if (!existing) return null;
  const next = { ...existing, ...patch };
  db.prepare(
    `UPDATE council_runs
     SET transcript = ?, consensus = ?, disagreement = ?, synthesis = ?, status = ?, consensus_detail = ?, matrix = ?
     WHERE id = ?`
  ).run(
    JSON.stringify(next.transcript),
    next.consensus,
    next.disagreement,
    next.synthesis,
    next.status,
    next.consensus_detail ? JSON.stringify(next.consensus_detail) : null,
    next.matrix ? JSON.stringify(next.matrix) : null,
    id
  );
  return getCouncilRun(id);
}
