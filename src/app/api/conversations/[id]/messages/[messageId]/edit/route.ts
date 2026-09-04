import { NextRequest, NextResponse } from "next/server";
import { addMessage, getActivePath, getConversation, listMessages, newMessageId } from "@/lib/repo/conversations";
import { hasAttachmentsForMessage } from "@/lib/repo/attachments";
import { resolveTurnModel, runChatTurn } from "@/lib/chatTurn";
import { prefetchRetrieval } from "@/lib/contextBuilder";
import { buildHistoryWindow } from "@/lib/conversationWindow";
import type { ModelRoleId } from "@/lib/models/types";

// Edits a user message by creating a new sibling (same parent as the
// original) rather than mutating it — the original message and everything
// that followed it stay exactly as they were, just off the active path,
// reachable again by switching branches back. See docs on branching in
// repo/conversations.ts (addMessage's parentId) and chatTurn.ts (parentId).
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string; messageId: string }> }) {
  const { id, messageId } = await ctx.params;
  const conversation = getConversation(id);
  if (!conversation) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });

  const original = listMessages(id).find((m) => m.id === messageId);
  if (!original) return NextResponse.json({ error: "Message not found" }, { status: 404 });
  if (original.role !== "user") {
    return NextResponse.json({ error: "Only a user message can be edited." }, { status: 400 });
  }
  // Carrying an attachment into a new branch isn't safe to do silently — see
  // hasAttachmentsForMessage's doc comment. The client already hides Edit for
  // these; this is the actual enforcement.
  if (hasAttachmentsForMessage(original.id)) {
    return NextResponse.json({ error: "A message with an attachment can't be edited." }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Request body was cut off" }, { status: 400 });
  const content = (body.content as string)?.trim();
  if (!content) return NextResponse.json({ error: "content is required" }, { status: 400 });
  const skillId = (body.skillId as string | undefined) ?? null;
  const requestedRole = (body.modelRole as ModelRoleId | "auto" | undefined) ?? "default";

  // Named before it exists so retrieval can exclude it and start now, ahead of
  // the model resolution below — see the same pattern in the chat route.
  const branchMessageId = newMessageId();
  const retrieval = prefetchRetrieval({
    projectId: conversation.project_id,
    query: content,
    excludeRefIds: [branchMessageId],
  });

  const turnModel = await resolveTurnModel(requestedRole, content, skillId);
  if (!turnModel.ok) return turnModel.response;

  const branchMessage = addMessage({
    id: branchMessageId,
    conversationId: id,
    role: "user",
    content,
    parentId: original.parent_id,
  });

  const windowed = await buildHistoryWindow(id, getActivePath(id));

  return runChatTurn({
    conversationId: id,
    projectId: conversation.project_id,
    history: windowed.history,
    skillId,
    turnModel: turnModel.value,
    signal: req.signal,
    query: content,
    excludeRefIds: [branchMessage.id],
    retrieval,
    parentId: branchMessage.id,
    conversationSummary: windowed.summary
      ? { text: windowed.summary, messageCount: windowed.summarizedCount }
      : null,
    summaryUsage: windowed,
  });
}
