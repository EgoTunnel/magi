import { NextRequest, NextResponse } from "next/server";
import { getConversation, getMessage } from "@/lib/repo/conversations";
import { askCouncilFromConversation, CONVERSATION_COUNCIL_MODES, type ConversationCouncilMode } from "@/lib/councilInConversation";
import { isAnyProviderConfigured } from "@/lib/models/registry";

// "Ask the Council" about a message in this conversation. Returns at once with
// the run; the Council deliberates in the background and posts its answer
// into the conversation when it's done (see councilInConversation.ts).
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!getConversation(id)) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  const body = await req.json().catch(() => null);
  const question = typeof body?.question === "string" ? body.question.trim() : "";
  const messageId = typeof body?.messageId === "string" ? body.messageId : "";
  const mode = (body?.mode ?? "independent") as ConversationCouncilMode;
  if (!question) return NextResponse.json({ error: "Give the Council a question." }, { status: 400 });
  const message = messageId ? getMessage(messageId) : null;
  if (!message || message.conversation_id !== id) {
    return NextResponse.json({ error: "That message isn't in this conversation." }, { status: 400 });
  }
  if (!CONVERSATION_COUNCIL_MODES.includes(mode)) {
    return NextResponse.json({ error: `Unknown Council mode: ${mode}` }, { status: 400 });
  }
  if (!isAnyProviderConfigured()) {
    return NextResponse.json({ error: "No API key configured. Add one in Settings." }, { status: 412 });
  }
  const run = askCouncilFromConversation({ conversationId: id, messageId, question, mode });
  return NextResponse.json({ run: { id: run.id, question: run.question, mode: run.mode, status: run.status } }, { status: 201 });
}
