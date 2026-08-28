import OpenAI from "openai";
import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";
import { getOpenRouterApiKey, getSetting, setSetting } from "@/lib/settings";
import type { CompleteOptions, ModelInfo, ModelProvider, ToolSpec } from "@/lib/models/types";

const MODELS_CACHE_KEY = "openrouter_models_cache";
const MAX_TOOL_ITERATIONS = 10;

function client() {
  const apiKey = getOpenRouterApiKey();
  if (!apiKey) throw new Error("NO_API_KEY");
  return new OpenAI({
    apiKey,
    baseURL: "https://openrouter.ai/api/v1",
    defaultHeaders: {
      // OpenRouter uses these purely for its own leaderboard/attribution — optional, harmless.
      "HTTP-Referer": "https://magi.local",
      "X-Title": "Magi",
    },
  });
}

interface OpenRouterModelEntry {
  id: string;
  name?: string;
  context_length?: number;
  pricing?: { prompt?: string; completion?: string };
}

function describe(m: OpenRouterModelEntry): string {
  const parts: string[] = [];
  if (m.context_length) {
    parts.push(`${Math.round(m.context_length / 1000)}k context`);
  }
  const promptPrice = m.pricing?.prompt ? parseFloat(m.pricing.prompt) : null;
  if (promptPrice !== null && !Number.isNaN(promptPrice) && promptPrice > 0) {
    parts.push(`$${(promptPrice * 1_000_000).toFixed(2)}/M in`);
  } else if (promptPrice === 0) {
    parts.push("free");
  }
  return parts.join(" · ") || "via OpenRouter";
}

function guessSpeed(id: string): ModelInfo["speed"] {
  const s = id.toLowerCase();
  if (/(mini|nano|small|haiku|flash|8b|3b|1b)/.test(s)) return "fast";
  if (/(opus|ultra|large|405b|70b|max)/.test(s)) return "deep";
  return "balanced";
}

// No model ids are hardcoded here — OpenRouter's catalog changes constantly,
// so the list always comes from a live call to their public /models endpoint
// rather than a guess baked into this codebase.
export async function refreshOpenRouterModels(): Promise<ModelInfo[]> {
  const res = await fetch("https://openrouter.ai/api/v1/models");
  if (!res.ok) throw new Error(`OpenRouter model list request failed (${res.status})`);
  const data = (await res.json()) as { data: OpenRouterModelEntry[] };
  const models: ModelInfo[] = (data.data ?? [])
    .map((m) => ({
      id: m.id,
      provider: "openrouter" as const,
      label: m.name || m.id,
      description: describe(m),
      speed: guessSpeed(m.id),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
  setSetting(MODELS_CACHE_KEY, JSON.stringify({ fetchedAt: new Date().toISOString(), models }));
  return models;
}

export function getCachedOpenRouterModels(): { models: ModelInfo[]; fetchedAt: string | null } {
  const raw = getSetting(MODELS_CACHE_KEY);
  if (!raw) return { models: [], fetchedAt: null };
  try {
    const parsed = JSON.parse(raw) as { fetchedAt: string; models: ModelInfo[] };
    return { models: parsed.models, fetchedAt: parsed.fetchedAt };
  } catch {
    return { models: [], fetchedAt: null };
  }
}

function toOpenAITools(tools?: ToolSpec[]): ChatCompletionTool[] | undefined {
  if (!tools || !tools.length) return undefined;
  return tools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.inputSchema },
  }));
}

function toWorkingMessages(opts: CompleteOptions): ChatCompletionMessageParam[] {
  const messages: ChatCompletionMessageParam[] = [];
  if (opts.system) messages.push({ role: "system", content: opts.system });
  for (const m of opts.messages) messages.push({ role: m.role, content: m.content });
  return messages;
}

// Some reasoning models proxied through OpenRouter (GLM, DeepSeek R1, QwQ, and
// others) can return an empty `content` alongside a separate `reasoning` /
// `reasoning_content` field when they spend their whole turn "thinking" —
// especially under a tight max_tokens budget. Treat that as the answer
// rather than showing the user nothing.
function extractText(message: { content?: string | null }): string {
  const content = message.content;
  if (content && content.trim()) return content;
  const loose = message as unknown as { reasoning?: string; reasoning_content?: string };
  const reasoning = loose.reasoning ?? loose.reasoning_content;
  if (reasoning && reasoning.trim()) return reasoning.trim();
  return content ?? "";
}

async function resolveToolCalls(
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

export const openRouterProvider: ModelProvider = {
  id: "openrouter",
  label: "OpenRouter",
  get models() {
    return getCachedOpenRouterModels().models;
  },
  isConfigured() {
    return !!getOpenRouterApiKey();
  },
  async complete(opts: CompleteOptions) {
    const c = client();
    const tools = toOpenAITools(opts.tools);
    const working = toWorkingMessages(opts);

    for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
      const res = await c.chat.completions.create({
        model: opts.model,
        messages: working,
        tools,
        max_tokens: opts.maxTokens ?? 2048,
      });
      const choice = res.choices[0];
      if (choice.finish_reason === "tool_calls" && choice.message.tool_calls?.length) {
        const toolResults = await resolveToolCalls(opts, choice.message.tool_calls);
        working.push(choice.message);
        working.push(...toolResults);
        continue;
      }
      return extractText(choice.message);
    }
    return "(Magi stopped calling tools after reaching this turn's limit, without a final answer.)";
  },
  async *stream(opts: CompleteOptions) {
    const c = client();
    const tools = toOpenAITools(opts.tools);
    const working = toWorkingMessages(opts);

    for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
      const stream = c.chat.completions.stream({
        model: opts.model,
        messages: working,
        tools,
        max_tokens: opts.maxTokens ?? 4096,
      });
      let emitted = "";
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) {
          emitted += delta;
          yield delta;
        }
      }

      const final = await stream.finalChatCompletion();
      const choice = final.choices[0];
      if (choice.finish_reason === "tool_calls" && choice.message.tool_calls?.length) {
        const toolResults = await resolveToolCalls(opts, choice.message.tool_calls);
        working.push(choice.message);
        working.push(...toolResults);
        continue;
      }
      if (!emitted.trim()) {
        const fallback = extractText(choice.message);
        if (fallback) yield fallback;
      }
      return;
    }
  },
};
