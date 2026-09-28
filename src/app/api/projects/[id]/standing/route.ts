import { NextRequest, NextResponse } from "next/server";
import { listProjectActivity } from "@/lib/repo/activity";
import { listProjectNotes } from "@/lib/repo/projectNotes";
import { listPeopleForProject } from "@/lib/repo/people";
import { listProposedSignals } from "@/lib/repo/standingSignals";

// Everything the "where the work stands" band needs, in one request — it is a
// single reading of the Project's state, not three independent widgets.
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const limit = Number(req.nextUrl.searchParams.get("limit") ?? 12);
  return NextResponse.json({
    notes: listProjectNotes(id),
    activity: listProjectActivity(id, Number.isFinite(limit) ? limit : 12),
    // Who this Project involves, proposed members included — the band is where
    // a proposal gets kept or discarded.
    people: listPeopleForProject(id),
    // What the watch noticed since the notes were last reviewed — a question
    // that looks answered, a decision that looks reopened — each pointing at
    // the conversation it happened in.
    signals: listProposedSignals(id),
  });
}
