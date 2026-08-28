import { NextRequest, NextResponse } from "next/server";
import {
  archiveConversation,
  deleteConversation,
  getConversation,
  listMessages,
  renameConversation,
} from "@/lib/repo/conversations";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const conversation = getConversation(id);
  if (!conversation) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ conversation, messages: listMessages(id) });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json();
  if (typeof body.title === "string") renameConversation(id, body.title);
  if (typeof body.archived === "boolean") archiveConversation(id, body.archived);
  return NextResponse.json({ conversation: getConversation(id) });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  deleteConversation(id);
  return NextResponse.json({ ok: true });
}
