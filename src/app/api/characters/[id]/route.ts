import { NextRequest, NextResponse } from "next/server";
import { deleteCharacter } from "@/lib/repo/characters";

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  deleteCharacter(id);
  return NextResponse.json({ ok: true });
}
