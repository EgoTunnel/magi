import { NextRequest, NextResponse } from "next/server";
import { deleteDocument, updateDocument } from "@/lib/repo/documents";

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json();
  const doc = updateDocument(id, body);
  return NextResponse.json({ document: doc });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  deleteDocument(id);
  return NextResponse.json({ ok: true });
}
