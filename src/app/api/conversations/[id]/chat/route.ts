import fs from "node:fs";
import { NextRequest, NextResponse } from "next/server";
import { addMessage, getConversation, listMessages } from "@/lib/repo/conversations";
import { getAttachment, attachToMessage, type Attachment } from "@/lib/repo/attachments";
import { attachArtifactsToMessage } from "@/lib/repo/artifacts";
import { buildSystemPrompt } from "@/lib/contextBuilder";
import { getModel, modelForRole, classifyModelRole, reasoningEffortForRole } from "@/lib/models/registry";
import type { ContentPart, ModelMessage, ModelRoleId, StreamEvent, TokenUsage, ToolCallRecord } from "@/lib/models/types";
import { resolveTools, executeTool } from "@/lib/tools/registry";
import { recordUsage } from "@/lib/repo/usage";
import { estimateCost } from "@/lib/models/pricing";

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

  const body = await req.json();
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

  let modelRole: ModelRoleId = requestedRole === "auto" ? "default" : requestedRole;
  let autoSelectedRole: string | undefined;
  let classifierUsage: TokenUsage[] = [];
  let classifierModelId = "";
  let classifierProviderId: "anthropic" | "openrouter" = "anthropic";
  if (requestedRole === "auto") {
    const classified = await classifyModelRole(content);
    modelRole = classified.role;
    autoSelectedRole = classified.role;
    classifierUsage = classified.usage;
    classifierModelId = classified.modelId;
    classifierProviderId = classified.providerId;
  }

  const modelId = modelForRole(modelRole);
  const resolved = getModel(modelId);
  if (!resolved) return NextResponse.json({ error: `Unknown model ${modelId}` }, { status: 500 });
  if (!resolved.provider.isConfigured()) {
    return NextResponse.json(
      { error: "NO_API_KEY", message: "No API key configured. Add one in Settings to start a conversation." },
      { status: 412 }
    );
  }

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

  const { system, provenance } = buildSystemPrompt({ projectId: conversation.project_id, skillId });
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

  const encoder = new TextEncoder();
  let full = "";
  const toolLog: ToolCallRecord[] = [];
  const createdArtifactIds: string[] = [];
  const usage: TokenUsage[] = [];
  const projectId = conversation.project_id;
  const providerId = resolved.provider.id as "anthropic" | "openrouter";

  if (classifierUsage.length) {
    recordUsage({
      projectId,
      source: "conversation",
      sourceId: id,
      provider: classifierProviderId,
      model: classifierModelId,
      role: "classifier",
      usage: classifierUsage,
    });
  }

  function finalProvenance() {
    const totalPrompt = usage.reduce((sum, u) => sum + u.promptTokens, 0);
    const totalCompletion = usage.reduce((sum, u) => sum + u.completionTokens, 0);
    recordUsage({
      projectId,
      source: "conversation",
      sourceId: id,
      provider: providerId,
      model: modelId,
      role: modelRole,
      usage,
    });
    return {
      ...provenance,
      toolCalls: toolLog,
      autoSelectedRole,
      usage: usage.length
        ? {
            promptTokens: totalPrompt,
            completionTokens: totalCompletion,
            costUsd: estimateCost(providerId, modelId, {
              promptTokens: totalPrompt,
              completionTokens: totalCompletion,
            }),
          }
        : undefined,
    };
  }

  const tools = resolveTools({ skillId });
  const allowedToolNames = new Set(tools.map((t) => t.name));

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const generator = resolved.provider.stream({
          model: modelId,
          system,
          messages: history,
          tools,
          onToolCall: (name, input) =>
            executeTool(name, input, {
              projectId,
              conversationId: id,
              allowedToolNames,
              onArtifactCreated: (artifactId) => createdArtifactIds.push(artifactId),
            }),
          toolLog,
          usage,
          reasoningEffort: reasoningEffortForRole(modelRole),
        });
        for await (const event of generator) {
          if (event.type === "text") full += event.text;
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        }
        const assistantMessage = addMessage({
          conversationId: id,
          role: "assistant",
          content: full || "(no response)",
          model: modelId,
          provenance: finalProvenance(),
        });
        if (createdArtifactIds.length) attachArtifactsToMessage(createdArtifactIds, assistantMessage.id);
        controller.close();
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        const errorEvent: StreamEvent = { type: "text", text: `\n\n[Magi encountered an error: ${message}]` };
        controller.enqueue(encoder.encode(`${JSON.stringify(errorEvent)}\n`));
        if (full) {
          const assistantMessage = addMessage({
            conversationId: id,
            role: "assistant",
            content: full,
            model: modelId,
            provenance: finalProvenance(),
          });
          if (createdArtifactIds.length) attachArtifactsToMessage(createdArtifactIds, assistantMessage.id);
        }
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "X-Magi-Provenance": encodeURIComponent(JSON.stringify(provenance)),
    },
  });
}
