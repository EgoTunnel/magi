import { db } from "@/lib/db";

// "Where the work stands" needs a single answer to "what has been happening
// here lately", not eight separate panels the reader has to reconcile by date.
// One UNION over everything a Project accumulates, newest first.
export type ActivityKind =
  | "conversation"
  | "document"
  | "artifact"
  | "memory"
  | "agent"
  | "council"
  | "connection"
  | "episode"
  | "image";

export interface ActivityEntry {
  kind: ActivityKind;
  id: string;
  // A second id some kinds need to build a link — an episode's conversation,
  // for instance. Empty when the row's own id is enough.
  ref: string;
  title: string;
  at: string;
  href: string;
}

interface ActivityRow {
  kind: ActivityKind;
  id: string;
  ref: string;
  title: string;
  at: string;
}

// Titles are truncated in SQL rather than in JS so a 200KB artifact body never
// crosses the process boundary just to be cut down to a line.
const ACTIVITY_SQL = `
  SELECT 'conversation' AS kind, id, '' AS ref, title, updated_at AS at
    FROM conversations WHERE project_id = ?
  UNION ALL
  SELECT 'document', id, '', title, updated_at FROM documents WHERE project_id = ?
  UNION ALL
  SELECT 'artifact', id, '', title, created_at FROM artifacts WHERE project_id = ?
  UNION ALL
  SELECT 'memory', id, '', substr(content, 1, 120), created_at
    FROM memory WHERE project_id = ? AND scope = 'project' AND status = 'established'
  UNION ALL
  SELECT 'agent', id, '', substr(objective, 1, 120), updated_at FROM agent_runs WHERE project_id = ?
  UNION ALL
  SELECT 'council', id, '', substr(question, 1, 120), created_at FROM council_runs WHERE project_id = ?
  UNION ALL
  SELECT 'connection', id, '', 'Connection investigation', updated_at
    FROM project_connections WHERE source_project_id = ?
  UNION ALL
  SELECT 'episode', id, conversation_id, 'Episode closed', created_at
    FROM episode_closures WHERE project_id = ?
  UNION ALL
  SELECT 'image', id, '', substr(prompt, 1, 120), created_at FROM images WHERE project_id = ?
  ORDER BY at DESC
  LIMIT ?
`;

function href(projectId: string, row: ActivityRow): string {
  switch (row.kind) {
    case "conversation":
      return `/projects/${projectId}/c/${row.id}`;
    case "episode":
      return `/projects/${projectId}/c/${row.ref}`;
    case "document":
      return `/projects/${projectId}#documents`;
    case "artifact":
      return `/projects/${projectId}#artifacts`;
    case "memory":
      return "/memory";
    case "agent":
      return `/agents/runs/${row.id}`;
    case "council":
      return `/councils/runs/${row.id}`;
    case "connection":
      return `/connections/runs/${row.id}`;
    case "image":
      return "/image-lab";
  }
}

// An afternoon of image generation, or a run of Council experiments, is one
// stretch of work — not the twelve most important things about a Project. A
// strictly chronological strip lets whichever kind happened to be busiest
// crowd out every other kind, which is exactly the reading this band exists to
// prevent. So each kind gets at most this many slots on the first pass; the
// remainder is topped up chronologically, so a Project that genuinely only
// contains conversations still fills the strip with them.
const MAX_PER_KIND = 3;

export function listProjectActivity(projectId: string, limit = 12): ActivityEntry[] {
  const ids = Array<string>(9).fill(projectId);
  const rows = db.prepare(ACTIVITY_SQL).all(...ids, limit * 5) as ActivityRow[];

  // Repeating the same title within a kind is almost always one action taken
  // several times (regenerating an image, re-running a Council on the same
  // question); only the most recent is worth a line.
  const seen = new Set<string>();
  const deduped = rows.filter((r) => {
    const key = `${r.kind}:${r.title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const perKind = new Map<ActivityKind, number>();
  const picked: ActivityRow[] = [];
  const overflow: ActivityRow[] = [];
  for (const row of deduped) {
    const used = perKind.get(row.kind) ?? 0;
    if (used >= MAX_PER_KIND) {
      overflow.push(row);
      continue;
    }
    perKind.set(row.kind, used + 1);
    picked.push(row);
  }
  const filled = [...picked, ...overflow.slice(0, Math.max(0, limit - picked.length))]
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    .slice(0, limit);

  return filled.map((row) => ({ ...row, href: href(projectId, row) }));
}
