import { NextRequest, NextResponse } from "next/server";
import { deleteMessage, getConversation, listMessages } from "@/lib/repo/conversations";
import { resolveTurnModel, runChatTurn } from "@/lib/chatTurn";
import { buildHistoryWindow } from "@/lib/conversationWindow";
import type { ModelMessage, ModelRoleId } from "@/lib/models/types";

function textOf(content: ModelMessage["content"]): string {
  if (typeof content === "string") return content;
  return content.find((p) => p.type === "text")?.text ?? "";
}

// Regenerates the *last* assistant reply in a conversation: only that case is
// supported (matching how "regenerate" reads in every chat product) since
// anything earlier would mean discarding everything that followed it too.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const conversation = getConversation(id);
  if (!conversation) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}) as Record<string, unknown>);
  const skillId = (body.skillId as string | undefined) ?? null;
  const requestedRole = (body.modelRole as ModelRoleId | "auto" | undefined) ?? "default";

  const messages = listMessages(id);
  const last = messages[messages.length - 1];
  if (!last || last.role !== "assistant") {
    return NextResponse.json(
      { error: "Only the most recent assistant reply can be regenerated." },
      { status: 400 }
    );
  }

  const windowed = await buildHistoryWindow(id, messages.slice(0, -1));
  const history = windowed.history;

  const lastUser = [...history].reverse().find((m) => m.role === "user");
  const turnModel = await resolveTurnModel(requestedRole, lastUser ? textOf(lastUser.content) : "");
  if (!turnModel.ok) return turnModel.response;

  deleteMessage(last.id);

  return runChatTurn({
    conversationId: id,
    projectId: conversation.project_id,
    history,
    skillId,
    turnModel: turnModel.value,
    signal: req.signal,
    conversationSummary: windowed.summary
      ? { text: windowed.summary, messageCount: windowed.summarizedCount }
      : null,
    summaryUsage: windowed,
  });
}
