import { NextRequest, NextResponse } from "next/server";
import { deleteSkill } from "@/lib/repo/skills";

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  deleteSkill(id);
  return NextResponse.json({ ok: true });
}
