import { NextRequest, NextResponse } from "next/server";
import { createNewVersion, getArtifact, listVersions } from "@/lib/repo/artifacts";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const artifact = getArtifact(id);
  if (!artifact) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ artifact, versions: listVersions(id) });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json();
  const artifact = createNewVersion(id, body.content, body.title);
  if (!artifact) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ artifact }, { status: 201 });
}
