import fs from "node:fs";
import { NextRequest, NextResponse } from "next/server";
import { addMessage, getConversation, listMessages } from "@/lib/repo/conversations";
import { getAttachment, attachToMessage, type Attachment } from "@/lib/repo/attachments";
import type { ContentPart, ModelMessage, ModelRoleId } from "@/lib/models/types";
import { resolveTurnModel, runChatTurn } from "@/lib/chatTurn";

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

  const turnModel = await resolveTurnModel(requestedRole, content);
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

  const userMessage = addMessage({ conversationId: id, role: "user", content: finalContent });
  if (attachments.length) attachToMessage(attachments.map((a) => a.id), userMessage.id);

  const history = listMessages(id)
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m): ModelMessage => ({ role: m.role as "user" | "assistant", content: m.content }));

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
  });
}
