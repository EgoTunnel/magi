import { NextRequest, NextResponse } from "next/server";
import { createCharacter, listCharacters } from "@/lib/repo/characters";

export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  return NextResponse.json({ characters: listCharacters(projectId) });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  if (!body.projectId || !body.name) {
    return NextResponse.json({ error: "projectId and name are required" }, { status: 400 });
  }
  const character = createCharacter(body.projectId, body.name, body.description ?? "");
  return NextResponse.json({ character }, { status: 201 });
}
