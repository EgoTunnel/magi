import { NextRequest, NextResponse } from "next/server";
import { mergePeople } from "@/lib/repo/people";

// Merging two people is always manual and always confirmed in the UI. There is
// no automatic version of this, and there should not be: a wrong merge in a
// rolodex is worse than a miss, because the user acts on it.
//
// The id in the path is the person being merged *away*; the survivor is named
// in the body, and inherits the loser's facts, associations, and name-as-alias.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json();
  if (!body.intoId) return NextResponse.json({ error: "intoId is required" }, { status: 400 });
  const person = mergePeople(id, String(body.intoId));
  if (!person) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ person });
}
