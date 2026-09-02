import { NextRequest, NextResponse } from "next/server";
import { createProjectNote, listProjectNotes, type ProjectNote } from "@/lib/repo/projectNotes";

export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  const status = req.nextUrl.searchParams.getAll("status") as ProjectNote["status"][];
  const kind = (req.nextUrl.searchParams.get("kind") as ProjectNote["kind"] | null) ?? undefined;
  return NextResponse.json({ notes: listProjectNotes(projectId, { status: status.length ? status : undefined, kind }) });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  if (!body.projectId || !body.content) {
    return NextResponse.json({ error: "projectId and content are required" }, { status: 400 });
  }
  if (body.kind !== "decision" && body.kind !== "question") {
    return NextResponse.json({ error: "kind must be 'decision' or 'question'" }, { status: 400 });
  }
  const note = createProjectNote({
    projectId: body.projectId,
    kind: body.kind,
    content: body.content,
    // A note written by hand is already the deliberate act — it doesn't need
    // reviewing the way a drafted one does.
    status: body.kind === "decision" ? "settled" : "open",
  });
  return NextResponse.json({ note }, { status: 201 });
}
