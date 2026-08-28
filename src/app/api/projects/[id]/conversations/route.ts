import { NextRequest, NextResponse } from "next/server";
import { createConversation, listConversations } from "@/lib/repo/conversations";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return NextResponse.json({ conversations: listConversations(id) });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const conversation = createConversation(id, body.title);
  return NextResponse.json({ conversation }, { status: 201 });
}
