import { NextRequest, NextResponse } from "next/server";
import { addPersonFact, getPerson, listPersonFacts } from "@/lib/repo/people";
import { attachClaimLinks } from "@/lib/sourceLinks";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return NextResponse.json({ facts: attachClaimLinks(listPersonFacts(id)) });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!getPerson(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await req.json();
  if (!body.content || !String(body.content).trim()) {
    return NextResponse.json({ error: "content is required" }, { status: 400 });
  }
  const fact = addPersonFact({
    personId: id,
    content: String(body.content),
    // A fact Magi proposes is suggested until kept; one the user typed here is
    // established, because writing it down *is* the deliberate act.
    status: body.status === "suggested" ? "suggested" : "established",
    source: body.source,
    closureId: body.closureId ?? null,
    sourceMessageId: body.sourceMessageId ?? null,
    sourceConversationId: body.sourceConversationId ?? null,
    // What a person is like changes. A new fact can name the one it replaces,
    // which retires the old one to history rather than leaving both current.
    supersedesId: body.supersedesId ?? null,
  });
  return NextResponse.json({ fact }, { status: 201 });
}
