import { NextRequest, NextResponse } from "next/server";
import { deleteMemory, setMemoryStatus, supersedeMemory, updateMemory } from "@/lib/repo/memory";

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json();
  let item = null;
  if (typeof body.content === "string") item = updateMemory(id, body.content);
  // Promoting a suggestion to established — the deliberate act that makes a
  // proposed memory item actually reach a prompt.
  if (body.status === "established" || body.status === "suggested") item = setMemoryStatus(id, body.status);
  // Retiring a fact that has stopped being true, optionally naming the one that
  // replaced it. Kept as history, inert everywhere else.
  if (body.status === "superseded") item = supersedeMemory(id, body.supersededBy ?? null);
  return NextResponse.json({ item });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  deleteMemory(id);
  return NextResponse.json({ ok: true });
}
