import { NextRequest, NextResponse } from "next/server";
import {
  archiveConversation,
  deleteConversation,
  getConversation,
  listMessages,
  moveConversation,
  renameConversation,
} from "@/lib/repo/conversations";
import { getProject } from "@/lib/repo/projects";

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
  if (typeof body.projectId === "string") {
    if (!getProject(body.projectId)) return NextResponse.json({ error: "target Project not found" }, { status: 400 });
    const moved = moveConversation(id, body.projectId);
    if (!moved) return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ conversation: getConversation(id) });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  deleteConversation(id);
  return NextResponse.json({ ok: true });
}
