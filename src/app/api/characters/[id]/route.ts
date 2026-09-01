import { NextRequest, NextResponse } from "next/server";
import { deleteCharacter, updateCharacter } from "@/lib/repo/characters";

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json();
  const patch: { name?: string; description?: string } = {};
  if (typeof body.name === "string") patch.name = body.name;
  if (typeof body.description === "string") patch.description = body.description;
  const character = updateCharacter(id, patch);
  if (!character) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ character });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  deleteCharacter(id);
  return NextResponse.json({ ok: true });
}
