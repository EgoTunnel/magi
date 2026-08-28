import { NextRequest, NextResponse } from "next/server";
import { deleteCouncil, getCouncil } from "@/lib/repo/councils";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const council = getCouncil(id);
  if (!council) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ council });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  deleteCouncil(id);
  return NextResponse.json({ ok: true });
}
