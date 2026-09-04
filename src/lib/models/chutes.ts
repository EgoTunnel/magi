// Manual fallback provider, not an automatic failover — see registry.ts.
// Chutes is an OpenAI-compatible inference marketplace built on Bittensor
// (decentralized GPU operators, not a single company's datacenters), picked
// specifically because it fails independently of OpenRouter: different
// infrastructure, different company (none, really), different failure modes.
// The point is to have a second place to point role assignments at by hand
// if OpenRouter is ever unusable, not to route between them automatically.
import OpenAI from "openai";
import type { ChatCompletionTool } from "openai/resources/chat/completions";
import { getChutesApiKey, getSetting, setSetting } from "@/lib/settings";
import type { CompleteOptions, ModelCapabilities, ModelInfo, ModelProvider, StreamEvent } from "@/lib/models/types";
import {
  DEFAULT_MAX_TOOL_ITERATIONS,
  extractText,
  resolveToolCalls,
  toOpenAITools,
  toWorkingMessages,
} from "@/lib/models/openaiCompatible";

const MODELS_CACHE_KEY = "chutes_models_cache";
const CAPABILITIES_CACHE_KEY = "chutes_capabilities_cache";
const MAX_TOOL_ITERATIONS = DEFAULT_MAX_TOOL_ITERATIONS;

function client() {
  const apiKey = getChutesApiKey();
  if (!apiKey) throw new Error("NO_API_KEY");
  return new OpenAI({ apiKey, baseURL: "https://llm.chutes.ai/v1" });
}

// Chutes' /v1/models entry shape (per their own docs, not OpenRouter's —
// fields are flat rather than nested under "architecture"/"pricing"). Kept
// loose (everything optional) since this is read from a live catalog this
// codebase doesn't control.
interface ChutesModelEntry {
  id: string;
  context_length?: number;
  max_model_len?: number;
  max_output_length?: number;
  input_modalities?: string[];
  output_modalities?: string[];
  supported_features?: string[];
  pricing?: { prompt?: string | number; completion?: string | number };
  price?: { input?: { usd?: number }; output?: { usd?: number } };
}

function describe(m: ChutesModelEntry): string {
  const parts: string[] = [];
  const context = m.context_length ?? m.max_model_len;
  if (context) parts.push(`${Math.round(context / 1000)}k context`);
  const promptPrice = parsePrice(m.pricing?.prompt) ?? m.price?.input?.usd ?? null;
  if (promptPrice !== null && promptPrice > 0) parts.push(`$${(promptPrice * 1_000_000).toFixed(2)}/M in`);
  else if (promptPrice === 0) parts.push("free");
  return parts.join(" · ") || "via Chutes";
}

function parsePrice(value: string | number | undefined): number | null {
  if (value === undefined) return null;
  const n = typeof value === "number" ? value : parseFloat(value);
  return Number.isNaN(n) ? null : n;
}

function guessSpeed(id: string): ModelInfo["speed"] {
  const s = id.toLowerCase();
  if (/(mini|nano|small|8b|3b|1b)/.test(s)) return "fast";
  if (/(ultra|large|405b|70b|max|235b)/.test(s)) return "deep";
  return "balanced";
}

// Mirrors refreshOpenRouterModels() in openrouter.ts: no model ids are
// hardcoded, the catalog always comes from a live call rather than a guess
// baked into this codebase.
export async function refreshChutesModels(): Promise<ModelInfo[]> {
  const res = await fetch("https://llm.chutes.ai/v1/models");
  if (!res.ok) throw new Error(`Chutes model list request failed (${res.status})`);
  const data = (await res.json()) as { data: ChutesModelEntry[] };
  const entries = data.data ?? [];

  const models: ModelInfo[] = entries
    .map((m) => ({
      id: m.id,
      provider: "chutes" as const,
      label: m.id,
      description: describe(m),
      speed: guessSpeed(m.id),
      supportsTools: (m.supported_features ?? []).includes("tools"),
      supportsVision: (m.input_modalities ?? []).includes("image"),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
  setSetting(MODELS_CACHE_KEY, JSON.stringify({ fetchedAt: new Date().toISOString(), models }));

  // Chutes' catalog doesn't document a "mandatory reasoning" flag or a list
  // of selectable reasoning efforts the way OpenRouter's does — only whether
  // a model supports reasoning at all. Rather than guess at request-param
  // names Chutes might not actually accept, reasoningEfforts stays empty
  // here, which makes requestExtras() below never send a reasoning override.
  // That's the same "fail open on missing data" posture openrouter.ts uses
  // for models it hasn't seen yet.
  const capabilities: Record<string, ModelCapabilities> = {};
  for (const m of entries) {
    const supported = m.supported_features ?? [];
    capabilities[m.id] = {
      supportsTools: supported.includes("tools"),
      reasoningMandatory: false,
      reasoningEfforts: [],
      maxCompletionTokens: m.max_output_length ?? null,
      pricePerPromptToken: parsePrice(m.pricing?.prompt) ?? m.price?.input?.usd ?? null,
      pricePerCompletionToken: parsePrice(m.pricing?.completion) ?? m.price?.output?.usd ?? null,
    };
  }
  setSetting(CAPABILITIES_CACHE_KEY, JSON.stringify(capabilities));

  return models;
}

export function getCachedChutesModels(): { models: ModelInfo[]; fetchedAt: string | null } {
  const raw = getSetting(MODELS_CACHE_KEY);
  if (!raw) return { models: [], fetchedAt: null };
  try {
    const parsed = JSON.parse(raw) as { fetchedAt: string; models: ModelInfo[] };
    return { models: parsed.models, fetchedAt: parsed.fetchedAt };
  } catch {
    return { models: [], fetchedAt: null };
  }
}

export function getChutesCapabilities(modelId: string): ModelCapabilities | null {
  const raw = getSetting(CAPABILITIES_CACHE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, ModelCapabilities>;
    return parsed[modelId] ?? null;
  } catch {
    return null;
  }
}

// Same fail-open posture as openrouter.ts's requestExtras(): an unknown
// model (capabilities not cached yet) keeps tools on and sends no reasoning
// override rather than guessing wrong.
function requestExtras(opts: CompleteOptions): { tools: ChatCompletionTool[] | undefined; maxTokens: number } {
  const capabilities = getChutesCapabilities(opts.model);
  const wantsTools = !!opts.tools?.length;
  const tools = wantsTools && capabilities?.supportsTools === false ? undefined : toOpenAITools(opts.tools);
  const requestedMax = opts.maxTokens ?? 4096;
  const maxTokens = capabilities?.maxCompletionTokens
    ? Math.min(requestedMax, capabilities.maxCompletionTokens)
    : requestedMax;
  return { tools, maxTokens };
}

export const chutesProvider: ModelProvider = {
  id: "chutes",
  label: "Chutes",
  get models() {
    return getCachedChutesModels().models;
  },
  isConfigured() {
    return !!getChutesApiKey();
  },
  async complete(opts: CompleteOptions) {
    const c = client();
    const { tools, maxTokens } = requestExtras(opts);
    const working = toWorkingMessages(opts);

    for (let iteration = 0; iteration < (opts.maxToolIterations ?? MAX_TOOL_ITERATIONS); iteration++) {
      const res = await c.chat.completions.create({
        model: opts.model,
        messages: working,
        tools,
        max_tokens: maxTokens,
      });
      // Every iteration is a real, separately-billed API call — including tool-use
      // round trips — so usage is recorded here, not just on the final answer.
      if (res.usage) {
        opts.usage?.push({ promptTokens: res.usage.prompt_tokens, completionTokens: res.usage.completion_tokens });
      }
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
    const { tools, maxTokens } = requestExtras(opts);
    const working = toWorkingMessages(opts);

    for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
      const stream = c.chat.completions.stream(
        {
          model: opts.model,
          messages: working,
          tools,
          max_tokens: maxTokens,
          // Required for an OpenAI-compatible streaming response to report usage
          // at all — without this, the final chunk simply omits the field.
          stream_options: { include_usage: true },
        },
        { signal: opts.signal }
      );
      let emitted = "";
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) {
          emitted += delta;
          yield { type: "text", text: delta } satisfies StreamEvent;
        }
      }

      const final = await stream.finalChatCompletion();
      if (final.usage) {
        opts.usage?.push({ promptTokens: final.usage.prompt_tokens, completionTokens: final.usage.completion_tokens });
      }
      const choice = final.choices[0];
      if (choice.finish_reason === "tool_calls" && choice.message.tool_calls?.length) {
        const calls = choice.message.tool_calls.filter((c) => c.type === "function");
        for (const call of calls) yield { type: "tool_start", name: call.function.name } satisfies StreamEvent;
        const toolResults = await resolveToolCalls(opts, choice.message.tool_calls);
        for (const call of calls) yield { type: "tool_end", name: call.function.name } satisfies StreamEvent;
        working.push(choice.message);
        working.push(...toolResults);
        continue;
      }
      if (!emitted.trim()) {
        const fallback = extractText(choice.message);
        if (fallback) yield { type: "text", text: fallback } satisfies StreamEvent;
      }
      return;
    }
  },
};
