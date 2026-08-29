import { NextRequest, NextResponse } from "next/server";
import { deleteStyleGuide } from "@/lib/repo/styleGuides";

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  deleteStyleGuide(id);
  return NextResponse.json({ ok: true });
}
