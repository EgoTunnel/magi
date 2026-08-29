import { NextRequest, NextResponse } from "next/server";
import { deleteImage, getImage } from "@/lib/repo/images";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const image = getImage(id);
  if (!image) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ image });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  deleteImage(id);
  return NextResponse.json({ ok: true });
}
