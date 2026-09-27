import { NextRequest, NextResponse } from "next/server";
import { getMessage } from "@/lib/repo/conversations";
import { acceptMemorySuggestion, dismissMemorySuggestion, draftMemory } from "@/lib/memorySuggestions";

// Acting on a "Worth remembering?" suggestion on a reply:
//   { action: "draft" }                          → a one-line memory to edit
//   { action: "accept", content, scope }         → keep it (established memory)
//   { action: "dismiss" }                        → stop suggesting it
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string; messageId: string }> }) {
  const { id, messageId } = await ctx.params;
  const message = getMessage(messageId);
  if (!message || message.conversation_id !== id) {
    return NextResponse.json({ error: "Message not found" }, { status: 404 });
  }
  const body = await req.json().catch(() => ({}));

  if (body.action === "draft") {
    try {
      return NextResponse.json(await draftMemory(messageId));
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't draft that." }, { status: 502 });
    }
  }
  if (body.action === "accept") {
    const content = typeof body.content === "string" ? body.content.trim() : "";
    const scope = body.scope === "global" ? "global" : "project";
    if (!content) return NextResponse.json({ error: "Nothing to remember." }, { status: 400 });
    return NextResponse.json({ item: acceptMemorySuggestion(messageId, content, scope) }, { status: 201 });
  }
  if (body.action === "dismiss") {
    dismissMemorySuggestion(messageId);
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
