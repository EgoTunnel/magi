import { NextRequest, NextResponse } from "next/server";
import { createCouncil, listCouncils } from "@/lib/repo/councils";

export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("projectId") ?? undefined;
  return NextResponse.json({ councils: listCouncils({ projectId }) });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  if (!body.name || !Array.isArray(body.roles) || !body.roles.length) {
    return NextResponse.json({ error: "name and roles[] are required" }, { status: 400 });
  }
  const council = createCouncil({
    scope: body.scope ?? "global",
    projectId: body.projectId,
    name: body.name,
    description: body.description,
    roles: body.roles,
  });
  return NextResponse.json({ council }, { status: 201 });
}
