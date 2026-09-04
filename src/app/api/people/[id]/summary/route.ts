import { NextRequest, NextResponse } from "next/server";
import { acceptSuggestedSummary, setSuggestedSummary } from "@/lib/repo/people";
import { draftPersonSummary } from "@/lib/personSummary";

// Drafts a summary from what is already known, and lands it as a proposal —
// the same posture as everything else Magi suggests about a person. Nothing
// reads it until it is kept.
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const result = await draftPersonSummary(id);
  if (!result) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, message: result.message },
      { status: result.error === "EMPTY" ? 502 : 412 }
    );
  }
  return NextResponse.json({ person: result.person });
}

// Keep or discard the draft.
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json();
  const person = body.accept ? acceptSuggestedSummary(id) : setSuggestedSummary(id, null);
  if (!person) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ person });
}
