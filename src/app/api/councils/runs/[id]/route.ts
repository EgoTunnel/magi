import { NextRequest, NextResponse } from "next/server";
import { getCouncilRun } from "@/lib/repo/councils";
import { getProject } from "@/lib/repo/projects";
import { listNotesForCouncilRun } from "@/lib/repo/projectNotes";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const run = getCouncilRun(id);
  if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });
  // What's been recorded from this deliberation, and where — so its page can
  // say so instead of offering to record it again.
  const project = run.project_id ? getProject(run.project_id) : null;
  return NextResponse.json({
    run,
    project: project ? { id: project.id, name: project.name } : null,
    notes: listNotesForCouncilRun(id),
  });
}
