import fs from "node:fs";
import { NextRequest, NextResponse } from "next/server";
import { addMessage, getConversation, getActivePath, newMessageId } from "@/lib/repo/conversations";
import { getAttachment, attachToMessage, type Attachment } from "@/lib/repo/attachments";
import type { ContentPart, ModelRoleId } from "@/lib/models/types";
import { resolveTurnModel, runChatTurn } from "@/lib/chatTurn";
import { prefetchRetrieval } from "@/lib/contextBuilder";
import { buildHistoryWindow } from "@/lib/conversationWindow";

// Per-attachment and combined caps on how much extracted text gets baked into
// a single turn — same truncate-with-note posture as DOCUMENT_BUDGET in
// contextBuilder.ts, just scoped to one message instead of the whole Project.
const ATTACHMENT_TEXT_BUDGET = 8000;
const ATTACHMENT_TOTAL_BUDGET = 16000;

function truncate(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit)}\n[…truncated…]` : text;
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const conversation = getConversation(id);
  if (!conversation) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });

  // A Stop pressed fast enough to land before the request body finished
  // uploading aborts the connection mid-body — req.json() then rejects with
  // a SyntaxError rather than anything meaningful to report.
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Request body was cut off" }, { status: 400 });
  const content = (body.content as string)?.trim();
  const skillId = (body.skillId as string | undefined) ?? null;
  const requestedRole = (body.modelRole as ModelRoleId | "auto" | undefined) ?? "default";
  const attachmentIds = Array.isArray(body.attachmentIds) ? (body.attachmentIds as string[]) : [];

  const attachments = attachmentIds
    .map((attId) => getAttachment(attId))
    .filter((a): a is Attachment => !!a && a.conversation_id === id && a.message_id === null);

  if (!content && attachments.length === 0) {
    return NextResponse.json({ error: "content or at least one attachment is required" }, { status: 400 });
  }

  // The id this turn's user message will be saved under, allocated now so
  // retrieval can start before the message exists and still know to exclude
  // it — without that exclusion the message reliably retrieves itself, being a
  // perfect match for a query that *is* it.
  const userMessageId = newMessageId();
  // Started before the model is resolved, not after. On an "Auto" turn
  // resolveTurnModel() below makes its own model call to classify the message,
  // and these two have nothing to say to each other — running them
  // concurrently costs the slower one instead of both.
  const retrieval = prefetchRetrieval({
    projectId: conversation.project_id,
    query: content,
    excludeRefIds: [userMessageId],
  });

  const turnModel = await resolveTurnModel(requestedRole, content, skillId);
  if (!turnModel.ok) return turnModel.response;
  const { resolved } = turnModel.value;

  let budgetLeft = ATTACHMENT_TOTAL_BUDGET;
  const attachmentSuffix = attachments
    .map((a) => {
      if (a.kind === "text") {
        const capped = truncate(a.extracted_text ?? "", Math.min(ATTACHMENT_TEXT_BUDGET, Math.max(budgetLeft, 0)));
        budgetLeft -= capped.length;
        return `\n\n## Attached: ${a.filename}\n${capped}`;
      }
      return `\n\n[Image attached: ${a.filename}]`;
    })
    .join("");
  const finalContent = content + attachmentSuffix;

  const userMessage = addMessage({ id: userMessageId, conversationId: id, role: "user", content: finalContent });
  if (attachments.length) attachToMessage(attachments.map((a) => a.id), userMessage.id);

  // Long conversations send a rolling summary of their older turns plus a
  // recent window, rather than every message every time — see
  // src/lib/conversationWindow.ts. Short ones are unaffected. getActivePath()
  // (not listMessages()) matters here specifically: it's the current branch
  // only — a different branch can contain an entire unrelated exchange that
  // just happens to sort in between chronologically, and the model must
  // never see that spliced into this turn's context as if it happened.
  const windowed = await buildHistoryWindow(id, getActivePath(id));
  const history = windowed.history;

  // Real image data is only ever sent for the live turn it was attached to —
  // history keeps the plain "[Image attached: …]" placeholder baked into
  // finalContent above (see the plan's third scope decision). Swap the last
  // history entry (the message just added) for a multimodal version only if
  // the assigned model actually supports vision; otherwise the placeholder
  // text already gives the model an honest fallback.
  const imageAttachments = attachments.filter((a) => a.kind === "image");
  if (imageAttachments.length && resolved.model.supportsVision !== false) {
    const parts: ContentPart[] = content ? [{ type: "text", text: content }] : [];
    for (const a of imageAttachments) {
      parts.push({
        type: "image",
        mimeType: a.mime_type,
        dataBase64: fs.readFileSync(a.file_path).toString("base64"),
      });
    }
    history[history.length - 1] = { role: "user", content: parts };
  }

  return runChatTurn({
    conversationId: id,
    projectId: conversation.project_id,
    history,
    skillId,
    turnModel: turnModel.value,
    signal: req.signal,
    // The message just sent — not derived from history, which may have had its
    // last entry swapped for a multimodal version above.
    query: content,
    excludeRefIds: [userMessage.id],
    retrieval,
    parentId: userMessage.id,
    conversationSummary: windowed.summary
      ? { text: windowed.summary, messageCount: windowed.summarizedCount }
      : null,
    summaryUsage: windowed,
  });
}
