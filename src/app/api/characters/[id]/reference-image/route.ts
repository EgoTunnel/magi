import { NextRequest, NextResponse } from "next/server";
import { setCharacterReferenceImage } from "@/lib/repo/characters";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json();
  if (!body.imageId) return NextResponse.json({ error: "imageId is required" }, { status: 400 });
  setCharacterReferenceImage(id, body.imageId);
  return NextResponse.json({ ok: true });
}
