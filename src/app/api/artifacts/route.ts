import { NextRequest, NextResponse } from "next/server";
import { createArtifact, listArtifacts, listArtifactsByConversation } from "@/lib/repo/artifacts";

export async function GET(req: NextRequest) {
  const conversationId = req.nextUrl.searchParams.get("conversationId");
  if (conversationId) return NextResponse.json({ artifacts: listArtifactsByConversation(conversationId) });

  const projectId = req.nextUrl.searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "projectId or conversationId is required" }, { status: 400 });
  return NextResponse.json({ artifacts: listArtifacts(projectId) });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  if (!body.projectId || !body.title) {
    return NextResponse.json({ error: "projectId and title are required" }, { status: 400 });
  }
  const artifact = createArtifact({
    projectId: body.projectId,
    conversationId: body.conversationId,
    title: body.title,
    type: body.type,
    content: body.content ?? "",
  });
  return NextResponse.json({ artifact }, { status: 201 });
}
