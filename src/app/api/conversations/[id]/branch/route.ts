import { NextRequest, NextResponse } from "next/server";
import { getConversation, listMessages, setHead } from "@/lib/repo/conversations";
import { resolveHeadTarget } from "@/lib/conversationBranches";

// Switches which branch is currently being viewed. Resolves to the leaf that
// branch was actually taken to (not just messageId itself), so jumping to an
// earlier fork lands on however far that branch was continued.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const conversation = getConversation(id);
  if (!conversation) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const messageId = body?.messageId as string | undefined;
  if (!messageId) return NextResponse.json({ error: "messageId is required" }, { status: 400 });

  const all = listMessages(id);
  if (!all.some((m) => m.id === messageId)) {
    return NextResponse.json({ error: "Message not found" }, { status: 404 });
  }

  setHead(id, resolveHeadTarget(all, messageId));
  return NextResponse.json({ ok: true });
}
