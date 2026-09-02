import { NextResponse } from "next/server";
import { attachArtifactsToMessage } from "@/lib/repo/artifacts";
import { addMessage } from "@/lib/repo/conversations";
import { buildSystemPrompt } from "@/lib/contextBuilder";
import { getModel, modelForRole, classifyModelRole, reasoningEffortForRole } from "@/lib/models/registry";
import type { ModelInfo, ModelMessage, ModelProvider, ModelRoleId, StreamEvent, TokenUsage, ToolCallRecord } from "@/lib/models/types";
import { resolveTools, executeTool } from "@/lib/tools/registry";
import { recordUsage } from "@/lib/repo/usage";
import { estimateCost } from "@/lib/models/pricing";
import { composeSkill } from "@/lib/skillComposition";

export interface ResolvedTurnModel {
  modelRole: ModelRoleId;
  modelId: string;
  resolved: { provider: ModelProvider; model: ModelInfo };
  autoSelectedRole?: string;
  classifierUsage: TokenUsage[];
  classifierModelId: string;
  classifierProviderId: "anthropic" | "openrouter";
}

// Picks the model for this turn (resolving "auto" via the classifier) and
// checks it's actually usable, *before* the caller commits any destructive
// change (saving the new user message, or deleting the message being
// regenerated) — so a missing API key never leaves the conversation with a
// question and no way to get an answer, or a deleted reply and no
// replacement.
export async function resolveTurnModel(
  requestedRole: ModelRoleId | "auto",
  classifierText: string,
  // The Skill selected for this turn, if any. A Skill that names a model role
  // is stating what its method needs — see src/lib/skillComposition.ts.
  skillId?: string | null
): Promise<{ ok: true; value: ResolvedTurnModel } | { ok: false; response: Response }> {
  let modelRole: ModelRoleId = requestedRole === "auto" ? "default" : requestedRole;
  let autoSelectedRole: string | undefined;
  let classifierUsage: TokenUsage[] = [];
  let classifierModelId = "";
  let classifierProviderId: "anthropic" | "openrouter" = "anthropic";
  if (requestedRole === "auto") {
    const classified = await classifyModelRole(classifierText);
    modelRole = classified.role;
    autoSelectedRole = classified.role;
    classifierUsage = classified.usage;
    classifierModelId = classified.modelId;
    classifierProviderId = classified.providerId;
  } else if (requestedRole === "default") {
    // Only when the user left the composer alone. An explicitly picked role,
    // and a classifier's answer on an Auto turn, both outrank the Skill —
    // a Skill supplies a default, it doesn't overrule a deliberate choice.
    const skill = composeSkill(skillId);
    if (skill?.modelRole) modelRole = skill.modelRole;
  }

  const modelId = modelForRole(modelRole);
  const resolved = getModel(modelId);
  if (!resolved) {
    return { ok: false, response: NextResponse.json({ error: `Unknown model ${modelId}` }, { status: 500 }) };
  }
  if (!resolved.provider.isConfigured()) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "NO_API_KEY", message: "No API key configured. Add one in Settings to start a conversation." },
        { status: 412 }
      ),
    };
  }

  return {
    ok: true,
    value: { modelRole, modelId, resolved, autoSelectedRole, classifierUsage, classifierModelId, classifierProviderId },
  };
}

// The shared core of "run one assistant turn and stream it back," used by
// both the normal chat route (a new user message was just added) and the
// regenerate route (no new user message — the prior assistant reply was
// deleted and this produces its replacement). Everything about building the
// system prompt, streaming, and persisting the result lives here so the two
// callers can't drift. Model selection itself already happened in
// resolveTurnModel() above.
export async function runChatTurn(opts: {
  conversationId: string;
  projectId: string;
  history: ModelMessage[];
  skillId: string | null;
  turnModel: ResolvedTurnModel;
  signal: AbortSignal;
  // What this turn is answering, used to retrieve the Project material that
  // actually bears on it. Defaults to the last user message in history, which
  // is the right answer for both callers (chat and regenerate).
  query?: string;
  // The rolling summary standing in for turns no longer in `history`, produced
  // by buildHistoryWindow() in the caller — which is where the raw Message
  // rows, and so the message ids that fold tracks, are available.
  conversationSummary?: { text: string; messageCount: number } | null;
  // Spend from generating that summary, recorded alongside this turn's own.
  summaryUsage?: { usage: TokenUsage[]; modelId: string | null; providerId: "anthropic" | "openrouter" | null };
}): Promise<Response> {
  const { conversationId, projectId, turnModel } = opts;
  const { modelRole, modelId, resolved, autoSelectedRole, classifierUsage, classifierModelId, classifierProviderId } =
    turnModel;

  const lastUser = [...opts.history].reverse().find((m) => m.role === "user");
  const query =
    opts.query ??
    (typeof lastUser?.content === "string"
      ? lastUser.content
      : (lastUser?.content?.find((p) => p.type === "text")?.text ?? ""));

  const { system, provenance } = await buildSystemPrompt({
    projectId,
    skillId: opts.skillId,
    query,
    conversationSummary: opts.conversationSummary,
  });

  const encoder = new TextEncoder();
  let full = "";
  const toolLog: ToolCallRecord[] = [];
  const createdArtifactIds: string[] = [];
  const usage: TokenUsage[] = [];
  const providerId = resolved.provider.id as "anthropic" | "openrouter";

  if (classifierUsage.length) {
    recordUsage({
      projectId,
      source: "conversation",
      sourceId: conversationId,
      provider: classifierProviderId,
      model: classifierModelId,
      role: "classifier",
      usage: classifierUsage,
    });
  }

  if (opts.summaryUsage?.usage.length && opts.summaryUsage.modelId && opts.summaryUsage.providerId) {
    recordUsage({
      projectId,
      source: "conversation",
      sourceId: conversationId,
      provider: opts.summaryUsage.providerId,
      model: opts.summaryUsage.modelId,
      role: "summarizer",
      usage: opts.summaryUsage.usage,
    });
  }

  function finalProvenance() {
    const totalPrompt = usage.reduce((sum, u) => sum + u.promptTokens, 0);
    const totalCompletion = usage.reduce((sum, u) => sum + u.completionTokens, 0);
    recordUsage({
      projectId,
      source: "conversation",
      sourceId: conversationId,
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

  const tools = resolveTools({ skillId: opts.skillId });
  const allowedToolNames = new Set(tools.map((t) => t.name));

  // opts.signal (NextRequest.signal) only reflects whether the *incoming*
  // request was aborted — once the response is streaming, a client that
  // stops reading it (Stop was pressed) doesn't fire that signal at all.
  // The reliable hook for "the client gave up on this response" is the
  // ReadableStream's own cancel() callback below, so a dedicated controller
  // is what actually gets threaded into the provider call; opts.signal is
  // wired in too, for the (rarer) case the request itself never finished.
  const turnAbort = new AbortController();
  opts.signal.addEventListener("abort", () => turnAbort.abort());

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // Once the client has disconnected (Stop was pressed) the controller
      // may already be closed by the runtime — writes past that point would
      // throw and crash this callback, so every enqueue/close is guarded.
      const safeEnqueue = (event: StreamEvent) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          // no-op
        }
      };
      const safeClose = () => {
        try {
          controller.close();
        } catch {
          // no-op
        }
      };

      try {
        const generator = resolved.provider.stream({
          model: modelId,
          system,
          messages: opts.history,
          tools,
          onToolCall: (name, input) =>
            executeTool(name, input, {
              projectId,
              conversationId,
              allowedToolNames,
              onArtifactCreated: (artifactId) => createdArtifactIds.push(artifactId),
            }),
          toolLog,
          usage,
          reasoningEffort: reasoningEffortForRole(modelRole),
          signal: turnAbort.signal,
        });
        for await (const event of generator) {
          if (event.type === "text") full += event.text;
          safeEnqueue(event);
        }
        const assistantMessage = addMessage({
          conversationId,
          role: "assistant",
          content: full || "(no response)",
          model: modelId,
          provenance: finalProvenance(),
        });
        if (createdArtifactIds.length) attachArtifactsToMessage(createdArtifactIds, assistantMessage.id);
        safeClose();
      } catch (err) {
        // Stop was pressed: the SDK call was cancelled via turnAbort.signal
        // (see cancel() below) and rejects with an abort error. That's an
        // intentional stop, not a failure — persist whatever text streamed
        // so far as-is, with no "[Magi encountered an error]" note tacked on.
        const isAbort = err instanceof Error && (err.name === "AbortError" || /abort/i.test(err.message));
        if (!isAbort) {
          const message = err instanceof Error ? err.message : "Unknown error";
          safeEnqueue({ type: "text", text: `\n\n[Magi encountered an error: ${message}]` });
        }
        if (full) {
          const assistantMessage = addMessage({
            conversationId,
            role: "assistant",
            content: full,
            model: modelId,
            provenance: finalProvenance(),
          });
          if (createdArtifactIds.length) attachArtifactsToMessage(createdArtifactIds, assistantMessage.id);
        }
        safeClose();
      }
    },
    // Invoked by the runtime when the consumer (the browser) stops reading
    // this response — exactly what happens when Stop aborts the client's
    // fetch mid-stream. This is what actually cancels the upstream model
    // call; without it, Stop only hid the response and the model kept
    // generating (and getting billed) to completion in the background.
    cancel(reason) {
      turnAbort.abort(reason);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "X-Magi-Provenance": encodeURIComponent(JSON.stringify(provenance)),
    },
  });
}
