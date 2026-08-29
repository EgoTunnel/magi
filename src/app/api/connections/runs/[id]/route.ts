import { NextRequest, NextResponse } from "next/server";
import { getConnectionRun } from "@/lib/repo/connections";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const run = getConnectionRun(id);
  if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ run });
}
