import { NextRequest, NextResponse } from "next/server";
import { deleteMemory, updateMemory } from "@/lib/repo/memory";

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json();
  const item = updateMemory(id, body.content);
  return NextResponse.json({ item });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  deleteMemory(id);
  return NextResponse.json({ ok: true });
}
