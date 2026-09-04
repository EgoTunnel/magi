import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { listMemory, setMemoryOrigin } from "@/lib/repo/memory";
import { listProjectsForPerson } from "@/lib/repo/people";
import { ensureChunkIndex, retrieveChunks } from "@/lib/retrieval";
import { resolveSourceLink } from "@/lib/sourceLinks";

// "Find where I learned this." A fact typed by hand has no origin, which is
// most of them — so rather than leaving the page claiming a provenance it
// doesn't have, this searches the archive for where the claim actually came
// from and offers candidates for the user to confirm.
//
// It proposes; it never links on its own. A wrong link is a false citation, and
// a false citation is worse than a missing one.
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const item = listMemory().find((m) => m.id === id);
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });

  ensureChunkIndex();

  // Scoped the same way mentions are: for a person fact, the Projects they are
  // actually on; for a Project fact, that Project.
  const projectId = item.person_id
    ? listProjectsForPerson(item.person_id).filter((p) => p.status === "established").map((p) => p.id)
    : item.project_id
      ? [item.project_id]
      : undefined;

  const chunks = await retrieveChunks(item.content, {
    projectId: projectId?.length ? projectId : undefined,
    kinds: ["message"],
    limit: 8,
    // The fact itself is indexed, and searching for its own text would return
    // it first every time.
    excludeRefIds: [item.id],
  }).catch(() => []);

  const messageIds = [...new Set(chunks.map((c) => c.refId))];
  const rows = messageIds.length
    ? (db
        .prepare(
          `SELECT m.id, m.role, m.created_at, c.id AS conversation_id, c.title AS conversation_title
           FROM messages m JOIN conversations c ON c.id = m.conversation_id
           WHERE m.id IN (${messageIds.map(() => "?").join(",")})`
        )
        .all(...messageIds) as Array<{
        id: string;
        role: string;
        created_at: string;
        conversation_id: string;
        conversation_title: string;
      }>)
    : [];
  const byId = new Map(rows.map((r) => [r.id, r]));

  const candidates = messageIds
    .map((refId) => {
      const row = byId.get(refId);
      if (!row) return null;
      const chunk = chunks.find((c) => c.refId === refId)!;
      const link = resolveSourceLink("message", refId);
      return {
        messageId: refId,
        conversationId: row.conversation_id,
        conversationTitle: row.conversation_title,
        role: row.role,
        date: row.created_at,
        preview: chunk.content.replace(/\s+/g, " ").slice(0, 260),
        href: link?.href ?? null,
        context: link?.context ?? null,
      };
    })
    .filter((c): c is NonNullable<typeof c> => c !== null);

  return NextResponse.json({ candidates });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json();
  const item = setMemoryOrigin(id, body.messageId ?? null, body.conversationId ?? null);
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ item });
}
