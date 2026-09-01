import { NextRequest, NextResponse } from "next/server";
import { createCouncilRun, getCouncil, type CouncilMode, type CouncilRole } from "@/lib/repo/councils";
import { runCouncilDeliberation } from "@/lib/council";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const question = (body.question as string)?.trim();
  if (!question) return NextResponse.json({ error: "question is required" }, { status: 400 });

  let roles: CouncilRole[] | undefined = body.roles;
  if (body.councilId) {
    const council = getCouncil(body.councilId);
    if (!council) return NextResponse.json({ error: "council not found" }, { status: 404 });
    roles = council.roles;
  }
  if (!roles || !roles.length) {
    return NextResponse.json({ error: "roles[] or councilId is required" }, { status: 400 });
  }

  const mode = (body.mode as CouncilMode | undefined) ?? "independent";
  if (mode === "debate" && roles.length !== 2) {
    return NextResponse.json({ error: "Debate mode needs exactly 2 roles." }, { status: 400 });
  }
  if (mode === "redTeam" && roles.length < 2) {
    return NextResponse.json({ error: "Red Team mode needs at least 2 roles." }, { status: 400 });
  }

  const run = createCouncilRun({ councilId: body.councilId, projectId: body.projectId, question, mode });

  // Fire-and-forget: Magi runs as a long-lived local server, not a serverless
  // function, so this keeps running after the response below is sent. The
  // client polls the run instead of holding the request open — deliberation
  // across several roles can take a while, and there's no reason to block on
  // it. runCouncilDeliberation catches its own errors and marks the run
  // "error" internally, so nothing here needs to react to a rejection.
  runCouncilDeliberation({ runId: run.id, question, roles, projectId: body.projectId, mode }).catch(() => {});

  return NextResponse.json({ run }, { status: 201 });
}
