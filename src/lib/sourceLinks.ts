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
  // Where this lives, in the user's terms — "KRG · Refining opening speaker
  // notes", not an id.
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

const FLAT_ROUTES: Partial<Record<SearchKind, string>> = {
  memory: "/memory",
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
