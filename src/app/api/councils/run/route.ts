import { NextRequest, NextResponse } from "next/server";
import { createCouncilRun, getCouncil, type CouncilRole } from "@/lib/repo/councils";
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

  const run = createCouncilRun({ councilId: body.councilId, projectId: body.projectId, question });
  await runCouncilDeliberation({ runId: run.id, question, roles, projectId: body.projectId });

  const { getCouncilRun } = await import("@/lib/repo/councils");
  return NextResponse.json({ run: getCouncilRun(run.id) });
}
