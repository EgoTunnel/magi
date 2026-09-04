import { NextRequest, NextResponse } from "next/server";
import { getPerson, listPersonMentions } from "@/lib/repo/people";
import { resolveSourceLinks } from "@/lib/sourceLinks";
import { ensureChunkIndex } from "@/lib/retrieval";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const person = getPerson(id);
  if (!person) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Mentions read the passage index, which for material that predates it is
  // built on first use rather than on the user knowing to press "Build index".
  ensureChunkIndex();

  const scope = req.nextUrl.searchParams.get("scope") === "everywhere" ? "everywhere" : undefined;
  const result = await listPersonMentions(person, { scope });
  const links = resolveSourceLinks(result.mentions.map((c) => ({ kind: c.kind, refId: c.refId })));
  return NextResponse.json({
    scope: result.scope,
    scopedProjectCount: result.scopedProjectIds.length,
    everywhereCount: result.everywhereCount,
    fellBack: result.fellBack,
    mentions: result.mentions.map((c) => {
      const link = links.get(`${c.kind}:${c.refId}`) ?? null;
      return {
        chunkId: c.chunkId,
        kind: c.kind,
        title: c.title,
        date: c.sourceDate,
        content: c.content,
        matchedBy: c.matchedBy,
        similarity: c.similarity,
        href: link?.href ?? null,
        context: link?.context ?? null,
      };
    }),
  });
}
