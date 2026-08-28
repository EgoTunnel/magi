import { NextRequest, NextResponse } from "next/server";
import { createSkill, listSkills } from "@/lib/repo/skills";

export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("projectId") ?? undefined;
  return NextResponse.json({ skills: listSkills({ projectId }) });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  if (!body.name || !body.instructions) {
    return NextResponse.json({ error: "name and instructions are required" }, { status: 400 });
  }
  const skill = createSkill({
    scope: body.scope ?? "global",
    projectId: body.projectId,
    name: body.name,
    description: body.description,
    instructions: body.instructions,
  });
  return NextResponse.json({ skill }, { status: 201 });
}
