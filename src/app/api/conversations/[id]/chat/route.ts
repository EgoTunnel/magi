import { NextRequest, NextResponse } from "next/server";
import { addMessage, getConversation, listMessages } from "@/lib/repo/conversations";
import { buildSystemPrompt } from "@/lib/contextBuilder";
import { getModel, modelForRole, classifyModelRole, reasoningEffortForRole } from "@/lib/models/registry";
import type { ModelMessage, ModelRoleId, TokenUsage, ToolCallRecord } from "@/lib/models/types";
import { resolveTools, executeTool } from "@/lib/tools/registry";
import { recordUsage } from "@/lib/repo/usage";
import { estimateCost } from "@/lib/models/pricing";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const conversation = getConversation(id);
  if (!conversation) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });

  const body = await req.json();
  const content = (body.content as string)?.trim();
  const skillId = (body.skillId as string | undefined) ?? null;
  const requestedRole = (body.modelRole as ModelRoleId | "auto" | undefined) ?? "default";
  if (!content) return NextResponse.json({ error: "content is required" }, { status: 400 });

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

  addMessage({ conversationId: id, role: "user", content });

  const { system, provenance } = buildSystemPrompt({ projectId: conversation.project_id, skillId });
  const history = listMessages(id)
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m): ModelMessage => ({ role: m.role as "user" | "assistant", content: m.content }));

  const encoder = new TextEncoder();
  let full = "";
  const toolLog: ToolCallRecord[] = [];
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
          onToolCall: (name, input) => executeTool(name, input, { projectId, allowedToolNames }),
          toolLog,
          usage,
          reasoningEffort: reasoningEffortForRole(modelRole),
        });
        for await (const chunk of generator) {
          full += chunk;
          controller.enqueue(encoder.encode(chunk));
        }
        addMessage({
          conversationId: id,
          role: "assistant",
          content: full || "(no response)",
          model: modelId,
          provenance: finalProvenance(),
        });
        controller.close();
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        controller.enqueue(encoder.encode(`\n\n[Magi encountered an error: ${message}]`));
        if (full) {
          addMessage({
            conversationId: id,
            role: "assistant",
            content: full,
            model: modelId,
            provenance: finalProvenance(),
          });
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
