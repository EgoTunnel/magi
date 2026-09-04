// Shared plumbing for any provider whose API is an OpenAI-compatible chat
// completions endpoint (OpenRouter, Chutes, and anything added later of the
// same shape). Only the parts that are byte-for-byte identical across those
// providers live here — request shaping that actually varies per provider
// (reasoning params, provider-specific plugins, pricing fields) stays in
// each provider's own file.
import type OpenAI from "openai";
import type { ChatCompletionContentPart, ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";
import type { CompleteOptions, ModelMessage, ToolSpec } from "@/lib/models/types";

export const DEFAULT_MAX_TOOL_ITERATIONS = 10;

export function toOpenAITools(tools?: ToolSpec[]): ChatCompletionTool[] | undefined {
  if (!tools || !tools.length) return undefined;
  return tools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.inputSchema },
  }));
}

export function toOpenAIContent(content: ModelMessage["content"]): string | ChatCompletionContentPart[] {
  if (typeof content === "string") return content;
  return content.map((part): ChatCompletionContentPart =>
    part.type === "image"
      ? { type: "image_url", image_url: { url: `data:${part.mimeType};base64,${part.dataBase64}` } }
      : { type: "text", text: part.text ?? "" }
  );
}

export function toWorkingMessages(opts: CompleteOptions): ChatCompletionMessageParam[] {
  const messages: ChatCompletionMessageParam[] = [];
  if (opts.system) messages.push({ role: "system", content: opts.system });
  for (const m of opts.messages) {
    messages.push(
      m.role === "user"
        ? { role: "user", content: toOpenAIContent(m.content) }
        : { role: "assistant", content: typeof m.content === "string" ? m.content : (m.content.find((p) => p.type === "text")?.text ?? "") }
    );
  }
  return messages;
}

// Some reasoning models proxied through these providers (GLM, DeepSeek R1,
// QwQ, and others) can return an empty `content` alongside a separate
// `reasoning` / `reasoning_content` field when they spend their whole turn
// "thinking" — especially under a tight max_tokens budget. Treat that as the
// answer rather than showing the user nothing.
export function extractText(message: { content?: string | null }): string {
  const content = message.content;
  if (content && content.trim()) return content;
  const loose = message as unknown as { reasoning?: string; reasoning_content?: string };
  const reasoning = loose.reasoning ?? loose.reasoning_content;
  if (reasoning && reasoning.trim()) return reasoning.trim();
  return content ?? "";
}

// The /v1/embeddings call, identical wherever it is served from — OpenRouter,
// or an Ollama/LM Studio endpoint on this machine. Batched because passage
// indexing turns one document into dozens of chunks, and sending them one
// request apiece would mean dozens of round trips per save.
export async function embedViaOpenAI(client: OpenAI, model: string, texts: string[]): Promise<number[][]> {
  if (!texts.length) return [];
  // encoding_format is explicit on purpose. Left unset, the OpenAI SDK asks for
  // base64 on the wire as an optimization and decodes it on the way back (see
  // node_modules/openai/lib/embeddings.js) — which is fine against OpenAI and
  // OpenRouter, and silently destroys the vectors from any server that ignores
  // the parameter and answers with plain float arrays, as local ones may. The
  // failure is empty embeddings rather than an error, so it would surface as
  // retrieval quietly getting worse.
  const res = await client.embeddings.create({ model, input: texts, encoding_format: "float" });
  if (res.data.length !== texts.length) {
    throw new Error(`Embedding request returned ${res.data.length} vectors for ${texts.length} inputs.`);
  }
  // Providers are not required to return the data array in input order — the
  // per-item index is authoritative, so re-sort rather than trusting position.
  return res.data
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((d) => decodeEmbedding(d.embedding));
}

// Asking for floats does not guarantee getting them: a server is free to
// answer in base64 regardless, and the typed SDK will hand it straight through
// as if it were an array of numbers. Converting here is what keeps "any
// OpenAI-compatible server" an honest claim.
function decodeEmbedding(embedding: number[] | string): number[] {
  if (typeof embedding !== "string") return embedding;
  const buf = Buffer.from(embedding, "base64");
  return Array.from(new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4));
}

export async function resolveToolCalls(
  opts: CompleteOptions,
  toolCalls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[]
): Promise<ChatCompletionMessageParam[]> {
  const results: ChatCompletionMessageParam[] = [];
  for (const call of toolCalls) {
    if (call.type !== "function") continue;
    let input: unknown = {};
    try {
      input = JSON.parse(call.function.arguments || "{}");
    } catch {
      // leave input as {} — the tool executor will report an error for missing fields
    }
    const result = opts.onToolCall ? await opts.onToolCall(call.function.name, input) : "(no tool executor configured)";
    opts.toolLog?.push({ name: call.function.name, input, result });
    results.push({ role: "tool", tool_call_id: call.id, content: result });
  }
  return results;
}
