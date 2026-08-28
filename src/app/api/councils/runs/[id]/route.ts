import { NextRequest, NextResponse } from "next/server";
import { getCouncilRun } from "@/lib/repo/councils";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const run = getCouncilRun(id);
  if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ run });
}
