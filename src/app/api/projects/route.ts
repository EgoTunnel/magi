import { NextRequest, NextResponse } from "next/server";
import { createProject, listProjects } from "@/lib/repo/projects";

export async function GET(req: NextRequest) {
  const status = req.nextUrl.searchParams.get("status") ?? "active";
  return NextResponse.json({ projects: listProjects({ status }) });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  if (!body.name || typeof body.name !== "string") {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  const project = createProject({
    name: body.name,
    tagline: body.tagline,
    purpose: body.purpose,
    instructions: body.instructions,
    parentProjectId: body.parentProjectId,
  });
  return NextResponse.json({ project }, { status: 201 });
}
