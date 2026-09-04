import { NextRequest, NextResponse } from "next/server";
import { getActivePath, getConversation } from "@/lib/repo/conversations";
import { resolveTurnModel, runChatTurn } from "@/lib/chatTurn";
import { prefetchRetrieval } from "@/lib/contextBuilder";
import { buildHistoryWindow } from "@/lib/conversationWindow";
import type { ModelRoleId } from "@/lib/models/types";

// Regenerates an assistant reply by creating a sibling (same parent as the
// message being replaced) rather than deleting it — the old reply and
// anything that followed it stay exactly as they were, just off the active
// path, reachable again by switching branches back. `messageId` omitted
// defaults to the active path's last message (today's simple "Regenerate"
// button); an explicit id is the newer capability — regenerating any earlier
// reply, not just the last one.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const conversation = getConversation(id);
  if (!conversation) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}) as Record<string, unknown>);
  const skillId = (body.skillId as string | undefined) ?? null;
  const requestedRole = (body.modelRole as ModelRoleId | "auto" | undefined) ?? "default";
  const requestedMessageId = body.messageId as string | undefined;

  const path = getActivePath(id);
  const target = requestedMessageId ? path.find((m) => m.id === requestedMessageId) : path[path.length - 1];
  if (!target || target.role !== "assistant") {
    return NextResponse.json({ error: "Only an assistant reply on the current branch can be regenerated." }, { status: 400 });
  }

  // The prefix of the active path ending at the user message being answered
  // — drops `target` and, if it wasn't the tail, everything that came after
  // it. This only shapes what's sent to the model; nothing is deleted.
  const targetIndex = path.findIndex((m) => m.id === target.id);
  const prefix = path.slice(0, targetIndex);

  // Taken from the raw path rather than from the windowed history below, so
  // retrieval and the history window can be started together — the question
  // being re-answered is known the moment the target is.
  const query = [...prefix].reverse().find((m) => m.role === "user")?.content ?? "";
  const excludeRefIds = target.parent_id ? [target.parent_id] : undefined;
  const retrieval = prefetchRetrieval({ projectId: conversation.project_id, query, excludeRefIds });

  const windowed = await buildHistoryWindow(id, prefix);
  const turnModel = await resolveTurnModel(requestedRole, query, skillId);
  if (!turnModel.ok) return turnModel.response;

  return runChatTurn({
    conversationId: id,
    projectId: conversation.project_id,
    history: windowed.history,
    skillId,
    turnModel: turnModel.value,
    signal: req.signal,
    query,
    excludeRefIds,
    retrieval,
    parentId: target.parent_id,
    conversationSummary: windowed.summary
      ? { text: windowed.summary, messageCount: windowed.summarizedCount }
      : null,
    summaryUsage: windowed,
  });
}
