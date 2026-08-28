import { NextRequest, NextResponse } from "next/server";
import { createMemory, listMemory } from "@/lib/repo/memory";

export async function GET(req: NextRequest) {
  const scope = req.nextUrl.searchParams.get("scope") as "global" | "project" | null;
  const projectId = req.nextUrl.searchParams.get("projectId") ?? undefined;
  return NextResponse.json({ memory: listMemory({ scope: scope ?? undefined, projectId }) });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  if (!body.content) return NextResponse.json({ error: "content is required" }, { status: 400 });
  const item = createMemory({
    scope: body.scope ?? "global",
    projectId: body.projectId,
    content: body.content,
    source: body.source,
    status: body.status,
  });
  return NextResponse.json({ item }, { status: 201 });
}
