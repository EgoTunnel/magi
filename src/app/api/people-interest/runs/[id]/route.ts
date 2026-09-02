import { NextRequest, NextResponse } from "next/server";
import { getPeopleInterestRun } from "@/lib/repo/peopleInterest";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const run = getPeopleInterestRun(id);
  if (!run) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ run });
}
