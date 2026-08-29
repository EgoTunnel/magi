import { db, newId, nowIso } from "@/lib/db";
import { estimateCost } from "@/lib/models/pricing";
import type { TokenUsage } from "@/lib/models/types";

export type UsageSource = "conversation" | "agent" | "council" | "connection" | "archive_ask";

export interface UsageEvent {
  id: string;
  project_id: string | null;
  source: UsageSource;
  source_id: string | null;
  provider: string;
  model: string;
  role: string | null;
  prompt_tokens: number;
  completion_tokens: number;
  cost_usd: number | null;
  created_at: string;
}

// Records every entry pushed into a provider call's `usage` out-param (there
// can be more than one per call — see anthropic.ts/openrouter.ts, each
// tool-use round trip is a separately billed request). Silently no-ops on an
// empty/missing usage array so call sites don't need to guard.
export function recordUsage(input: {
  projectId?: string | null;
  source: UsageSource;
  sourceId?: string | null;
  provider: "anthropic" | "openrouter";
  model: string;
  role?: string | null;
  usage?: TokenUsage[];
}) {
  if (!input.usage?.length) return;
  const ts = nowIso();
  const insert = db.prepare(
    `INSERT INTO usage_events
     (id, project_id, source, source_id, provider, model, role, prompt_tokens, completion_tokens, cost_usd, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const u of input.usage) {
    const cost = estimateCost(input.provider, input.model, u);
    insert.run(
      newId("usage"),
      input.projectId ?? null,
      input.source,
      input.sourceId ?? null,
      input.provider,
      input.model,
      input.role ?? null,
      u.promptTokens,
      u.completionTokens,
      cost,
      ts
    );
  }
}

export interface SpendTotals {
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  // True when at least one contributing event has unknown pricing — the
  // total therefore understates real spend rather than guessing at it.
  hasUnpricedEvents: boolean;
}

function toTotals(rows: Array<{ prompt_tokens: number; completion_tokens: number; cost_usd: number | null }>): SpendTotals {
  return rows.reduce<SpendTotals>(
    (acc, r) => ({
      promptTokens: acc.promptTokens + r.prompt_tokens,
      completionTokens: acc.completionTokens + r.completion_tokens,
      costUsd: acc.costUsd + (r.cost_usd ?? 0),
      hasUnpricedEvents: acc.hasUnpricedEvents || r.cost_usd === null,
    }),
    { promptTokens: 0, completionTokens: 0, costUsd: 0, hasUnpricedEvents: false }
  );
}

export function totalSpend(opts: { sinceIso?: string } = {}): SpendTotals {
  const rows = opts.sinceIso
    ? (db.prepare(`SELECT prompt_tokens, completion_tokens, cost_usd FROM usage_events WHERE created_at >= ?`).all(opts.sinceIso) as Array<{
        prompt_tokens: number;
        completion_tokens: number;
        cost_usd: number | null;
      }>)
    : (db.prepare(`SELECT prompt_tokens, completion_tokens, cost_usd FROM usage_events`).all() as Array<{
        prompt_tokens: number;
        completion_tokens: number;
        cost_usd: number | null;
      }>);
  return toTotals(rows);
}

export function spendByModel(): Array<{ provider: string; model: string } & SpendTotals> {
  const rows = db
    .prepare(
      `SELECT provider, model, prompt_tokens, completion_tokens, cost_usd FROM usage_events`
    )
    .all() as Array<{ provider: string; model: string; prompt_tokens: number; completion_tokens: number; cost_usd: number | null }>;
  const byKey = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = `${r.provider}:${r.model}`;
    const list = byKey.get(key) ?? [];
    list.push(r);
    byKey.set(key, list);
  }
  return Array.from(byKey.entries())
    .map(([key, list]) => {
      const [provider, model] = key.split(":");
      return { provider, model, ...toTotals(list) };
    })
    .sort((a, b) => b.costUsd - a.costUsd || b.promptTokens + b.completionTokens - (a.promptTokens + a.completionTokens));
}

export function spendByProject(): Array<{ projectId: string | null } & SpendTotals> {
  const rows = db
    .prepare(`SELECT project_id, prompt_tokens, completion_tokens, cost_usd FROM usage_events`)
    .all() as Array<{ project_id: string | null; prompt_tokens: number; completion_tokens: number; cost_usd: number | null }>;
  const byProject = new Map<string | null, typeof rows>();
  for (const r of rows) {
    const list = byProject.get(r.project_id) ?? [];
    list.push(r);
    byProject.set(r.project_id, list);
  }
  return Array.from(byProject.entries())
    .map(([projectId, list]) => ({ projectId, ...toTotals(list) }))
    .sort((a, b) => b.costUsd - a.costUsd);
}

export function recentUsageEvents(limit = 20): UsageEvent[] {
  return db.prepare(`SELECT * FROM usage_events ORDER BY created_at DESC LIMIT ?`).all(limit) as UsageEvent[];
}
