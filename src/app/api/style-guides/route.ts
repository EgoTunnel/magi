import { NextRequest, NextResponse } from "next/server";
import { createStyleGuide, listStyleGuides } from "@/lib/repo/styleGuides";

export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  return NextResponse.json({ styleGuides: listStyleGuides(projectId) });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  if (!body.projectId || !body.name) {
    return NextResponse.json({ error: "projectId and name are required" }, { status: 400 });
  }
  const styleGuide = createStyleGuide(body.projectId, body.name, body.description ?? "");
  return NextResponse.json({ styleGuide }, { status: 201 });
}
