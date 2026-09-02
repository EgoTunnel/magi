import { db } from "@/lib/db";
import type { SearchKind } from "@/lib/searchIndex";

// "Where did that come from?" is only a real answer if you can go there. This
// turns an indexed item's (kind, ref_id) — which is all a passage or a memory
// item records — into somewhere in the app to click.
//
// Resolved once, at the moment provenance is written, rather than at render
// time: provenance is stored JSON that outlives the turn, and a link computed
// now stays meaningful even if the item is later renamed.
export interface SourceLink {
  href: string;
  // Where this lives, in the user's terms — "Field Notes · Refining the
  // opening", not an id.
  context: string;
}

function messageLinks(refIds: string[]): Map<string, SourceLink> {
  const out = new Map<string, SourceLink>();
  if (!refIds.length) return out;
  const rows = db
    .prepare(
      `SELECT m.id, c.id AS conversation_id, c.title AS conversation_title, p.id AS project_id, p.name AS project_name
       FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
       JOIN projects p ON p.id = c.project_id
       WHERE m.id IN (${refIds.map(() => "?").join(",")})`
    )
    .all(...refIds) as Array<{
    id: string;
    conversation_id: string;
    conversation_title: string;
    project_id: string;
    project_name: string;
  }>;
  for (const r of rows) {
    out.set(r.id, {
      // The fragment is the message's own element id — see ConversationView,
      // which scrolls to it and highlights it on arrival.
      href: `/projects/${r.project_id}/c/${r.conversation_id}#${r.id}`,
      context: `${r.project_name} · ${r.conversation_title}`,
    });
  }
  return out;
}

function conversationLinks(refIds: string[]): Map<string, SourceLink> {
  const out = new Map<string, SourceLink>();
  if (!refIds.length) return out;
  const rows = db
    .prepare(
      `SELECT c.id, c.title, p.id AS project_id, p.name AS project_name
       FROM conversations c JOIN projects p ON p.id = c.project_id
       WHERE c.id IN (${refIds.map(() => "?").join(",")})`
    )
    .all(...refIds) as Array<{ id: string; title: string; project_id: string; project_name: string }>;
  for (const r of rows) {
    // Conversations are indexed with empty content, so they never produce a
    // retrieved passage — this path exists for memory items an episode closing
    // proposed, where naming the conversation is the whole point.
    out.set(r.id, { href: `/projects/${r.project_id}/c/${r.id}`, context: `${r.project_name} · ${r.title}` });
  }
  return out;
}

// Documents and artifacts have no page of their own — they live in sections of
// the Project dashboard, so the link goes there with the section anchored.
function projectScopedLinks(
  table: "documents" | "artifacts",
  anchor: string,
  refIds: string[]
): Map<string, SourceLink> {
  const out = new Map<string, SourceLink>();
  if (!refIds.length) return out;
  const rows = db
    .prepare(
      `SELECT t.id, p.id AS project_id, p.name AS project_name
       FROM ${table} t JOIN projects p ON p.id = t.project_id
       WHERE t.id IN (${refIds.map(() => "?").join(",")})`
    )
    .all(...refIds) as Array<{ id: string; project_id: string; project_name: string }>;
  for (const r of rows) {
    out.set(r.id, { href: `/projects/${r.project_id}#${anchor}`, context: r.project_name });
  }
  return out;
}

// A fact about someone belongs to that person, not to the undifferentiated
// Memory page — "where did that come from?" should land where the rest of what
// is known about them is. Rows without a person_id fall through to /memory.
function memoryLinks(refIds: string[]): Map<string, SourceLink> {
  const out = new Map<string, SourceLink>();
  if (!refIds.length) return out;
  const rows = db
    .prepare(
      `SELECT m.id, p.id AS person_id, p.name AS person_name
       FROM memory m LEFT JOIN people p ON p.id = m.person_id
       WHERE m.id IN (${refIds.map(() => "?").join(",")})`
    )
    .all(...refIds) as Array<{ id: string; person_id: string | null; person_name: string | null }>;
  for (const r of rows) {
    out.set(
      r.id,
      r.person_id
        ? { href: `/people/${r.person_id}`, context: r.person_name ?? "" }
        : { href: "/memory", context: "" }
    );
  }
  return out;
}

function personLinks(refIds: string[]): Map<string, SourceLink> {
  const out = new Map<string, SourceLink>();
  if (!refIds.length) return out;
  const rows = db
    .prepare(`SELECT id, name FROM people WHERE id IN (${refIds.map(() => "?").join(",")})`)
    .all(...refIds) as Array<{ id: string; name: string }>;
  for (const r of rows) out.set(r.id, { href: `/people/${r.id}`, context: r.name });
  return out;
}

const FLAT_ROUTES: Partial<Record<SearchKind, string>> = {
  skill: "/skills",
  style_guide: "/image-lab",
  character: "/image-lab",
};

export function resolveSourceLinks(items: Array<{ kind: SearchKind; refId: string }>): Map<string, SourceLink> {
  const byKind = new Map<SearchKind, string[]>();
  for (const item of items) {
    const list = byKind.get(item.kind);
    if (list) list.push(item.refId);
    else byKind.set(item.kind, [item.refId]);
  }

  const out = new Map<string, SourceLink>();
  const add = (kind: SearchKind, links: Map<string, SourceLink>) => {
    for (const [refId, link] of links) out.set(`${kind}:${refId}`, link);
  };

  add("message", messageLinks(byKind.get("message") ?? []));
  add("conversation", conversationLinks(byKind.get("conversation") ?? []));
  add("document", projectScopedLinks("documents", "documents", byKind.get("document") ?? []));
  add("artifact", projectScopedLinks("artifacts", "artifacts", byKind.get("artifact") ?? []));
  add("memory", memoryLinks(byKind.get("memory") ?? []));
  add("person", personLinks(byKind.get("person") ?? []));

  for (const refId of byKind.get("project") ?? []) {
    out.set(`project:${refId}`, { href: `/projects/${refId}`, context: "Project" });
  }
  for (const [kind, href] of Object.entries(FLAT_ROUTES) as [SearchKind, string][]) {
    for (const refId of byKind.get(kind) ?? []) {
      out.set(`${kind}:${refId}`, { href, context: "" });
    }
  }
  return out;
}

export function resolveSourceLink(kind: SearchKind, refId: string): SourceLink | null {
  return resolveSourceLinks([{ kind, refId }]).get(`${kind}:${refId}`) ?? null;
}

// Claim-level provenance for a list of memory rows: the exact message a fact
// was promoted from, or the conversation an episode closing proposed it in.
// Two batched queries for the whole list rather than one per row.
export function attachClaimLinks<
  T extends { source_message_id: string | null; source_conversation_id: string | null }
>(items: T[]): Array<T & { sourceLink: SourceLink | null }> {
  const messageLinks = resolveSourceLinks(
    items.filter((i) => i.source_message_id).map((i) => ({ kind: "message" as const, refId: i.source_message_id! }))
  );
  const conversationLinks = resolveSourceLinks(
    items
      .filter((i) => !i.source_message_id && i.source_conversation_id)
      .map((i) => ({ kind: "conversation" as const, refId: i.source_conversation_id! }))
  );
  return items.map((i) => ({
    ...i,
    sourceLink:
      (i.source_message_id ? messageLinks.get(`message:${i.source_message_id}`) : null) ??
      (i.source_conversation_id ? conversationLinks.get(`conversation:${i.source_conversation_id}`) : null) ??
      null,
  }));
}
