import { NextRequest, NextResponse } from "next/server";
import { createDocument, listDocuments } from "@/lib/repo/documents";

export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  return NextResponse.json({ documents: listDocuments(projectId) });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  if (!body.projectId || !body.title) {
    return NextResponse.json({ error: "projectId and title are required" }, { status: 400 });
  }
  const doc = createDocument(body.projectId, body.title, body.content ?? "");
  return NextResponse.json({ document: doc }, { status: 201 });
}
