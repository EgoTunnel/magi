import { NextRequest, NextResponse } from "next/server";
import { listProjectActivity } from "@/lib/repo/activity";
import { listProjectNotes } from "@/lib/repo/projectNotes";

// Everything the "where the work stands" band needs, in one request — it is a
// single reading of the Project's state, not three independent widgets.
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const limit = Number(req.nextUrl.searchParams.get("limit") ?? 12);
  return NextResponse.json({
    notes: listProjectNotes(id),
    activity: listProjectActivity(id, Number.isFinite(limit) ? limit : 12),
  });
}
