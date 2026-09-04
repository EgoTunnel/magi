import OpenAI from "openai";
import type { ChatCompletionTool } from "openai/resources/chat/completions";
import { getOpenRouterApiKey, getTavilyApiKey, getSetting, setSetting } from "@/lib/settings";
import type {
  CompleteOptions,
  ModelCapabilities,
  ModelInfo,
  ModelProvider,
  ReasoningEffort,
  StreamEvent,
} from "@/lib/models/types";
import { REASONING_EFFORTS } from "@/lib/models/types";
// Type-only: embeddings.ts imports this module's functions at runtime, so a
// value import here would be a real cycle. Types are erased, this is not.
import type { EmbeddingModelInfo } from "@/lib/models/embeddings";
import {
  DEFAULT_MAX_TOOL_ITERATIONS,
  embedViaOpenAI,
  extractText,
  resolveToolCalls,
  toOpenAITools,
  toWorkingMessages,
} from "@/lib/models/openaiCompatible";

const MODELS_CACHE_KEY = "openrouter_models_cache";
const IMAGE_MODELS_CACHE_KEY = "openrouter_image_models_cache";
const CAPABILITIES_CACHE_KEY = "openrouter_capabilities_cache";
const MAX_TOOL_ITERATIONS = DEFAULT_MAX_TOOL_ITERATIONS;

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
  architecture?: { input_modalities?: string[]; output_modalities?: string[] };
  supported_parameters?: string[];
  reasoning?: { mandatory?: boolean; supported_efforts?: string[] };
  top_provider?: { max_completion_tokens?: number };
}

export interface ImageModelInfo {
  id: string;
  label: string;
  description: string;
  editsImages: boolean;
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
  const entries = data.data ?? [];

  const models: ModelInfo[] = entries
    .map((m) => ({
      id: m.id,
      provider: "openrouter" as const,
      label: m.name || m.id,
      description: describe(m),
      speed: guessSpeed(m.id),
      supportsTools: (m.supported_parameters ?? []).includes("tools"),
      supportsVision: (m.architecture?.input_modalities ?? []).includes("image"),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
  setSetting(MODELS_CACHE_KEY, JSON.stringify({ fetchedAt: new Date().toISOString(), models }));

  // Image Studio only needs models whose output includes "image" — a small
  // subset, fetched from the same call rather than a second guess-based list.
  const imageModels: ImageModelInfo[] = entries
    .filter((m) => m.architecture?.output_modalities?.includes("image"))
    .map((m) => ({
      id: m.id,
      label: m.name || m.id,
      description: describe(m),
      editsImages: !!m.architecture?.input_modalities?.includes("image"),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
  setSetting(IMAGE_MODELS_CACHE_KEY, JSON.stringify({ fetchedAt: new Date().toISOString(), models: imageModels }));

  // The behavior that actually varies model-to-model — tool support, whether
  // reasoning can be turned down, the real output ceiling — read from
  // OpenRouter's own metadata rather than assumed. This is what lets Magi
  // stay correct across models it has never seen without a code change: the
  // *shape* of the variance is fixed here, only the *values* come from the
  // live catalog.
  const capabilities: Record<string, ModelCapabilities> = {};
  const validEfforts = new Set<string>(REASONING_EFFORTS);
  for (const m of entries) {
    const supported = m.supported_parameters ?? [];
    const promptPrice = m.pricing?.prompt ? parseFloat(m.pricing.prompt) : NaN;
    const completionPrice = m.pricing?.completion ? parseFloat(m.pricing.completion) : NaN;
    capabilities[m.id] = {
      supportsTools: supported.includes("tools"),
      reasoningMandatory: !!m.reasoning?.mandatory,
      reasoningEfforts: (m.reasoning?.supported_efforts ?? []).filter((e): e is ReasoningEffort =>
        validEfforts.has(e)
      ),
      maxCompletionTokens: m.top_provider?.max_completion_tokens ?? null,
      pricePerPromptToken: Number.isNaN(promptPrice) ? null : promptPrice,
      pricePerCompletionToken: Number.isNaN(completionPrice) ? null : completionPrice,
    };
  }
  setSetting(CAPABILITIES_CACHE_KEY, JSON.stringify(capabilities));

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

export function getOpenRouterCapabilities(modelId: string): ModelCapabilities | null {
  const raw = getSetting(CAPABILITIES_CACHE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, ModelCapabilities>;
    return parsed[modelId] ?? null;
  } catch {
    return null;
  }
}

export function getCachedOpenRouterImageModels(): { models: ImageModelInfo[]; fetchedAt: string | null } {
  const raw = getSetting(IMAGE_MODELS_CACHE_KEY);
  if (!raw) return { models: [], fetchedAt: null };
  try {
    const parsed = JSON.parse(raw) as { fetchedAt: string; models: ImageModelInfo[] };
    return { models: parsed.models, fetchedAt: parsed.fetchedAt };
  } catch {
    return { models: [], fetchedAt: null };
  }
}

// Unlike chat and image models, OpenRouter's /models catalog does not list
// embedding-capable models at all (confirmed by direct testing: none of its
// ~400 entries advertise an "embeddings" output modality), even though
// /v1/embeddings itself works fine when called with a known-good model id.
// So this is a short, hand-verified list — the same reasoning that makes
// anthropic.ts hardcode its MODELS array: hardcode only where there is
// genuinely no live catalog to read from instead.
export const OPENROUTER_EMBEDDING_MODELS: EmbeddingModelInfo[] = [
  { id: "openai/text-embedding-3-small", label: "OpenAI: Text Embedding 3 Small", description: "Fast, inexpensive, 1536 dimensions" },
  { id: "openai/text-embedding-3-large", label: "OpenAI: Text Embedding 3 Large", description: "Higher quality, 3072 dimensions" },
  { id: "google/gemini-embedding-001", label: "Google: Gemini Embedding 001", description: "Google's general-purpose embedding model" },
  { id: "qwen/qwen3-embedding-8b", label: "Qwen: Qwen3 Embedding 8B", description: "Open-weight, strong multilingual performance" },
];

// Standard OpenAI-compatible shape, unlike image generation — the typed SDK
// client already covers this, no raw fetch needed. Callers outside this file
// should go through src/lib/models/embeddings.ts rather than here, so that
// which provider serves a model stays one decision in one place.
export async function embedTexts(model: string, texts: string[]): Promise<number[][]> {
  return embedViaOpenAI(client(), model, texts);
}

export interface GeneratedImagePart {
  dataUrl: string;
}

// A named reference image — the label is sent as its own text block
// immediately before the image so the model knows what the image actually
// is (a specific character's real appearance, vs. a base image to vary),
// rather than a pile of unlabeled images it has to guess about.
export interface ReferenceImageInput {
  label: string;
  dataUrl: string;
}

// A direct fetch call rather than routing through the `openai` SDK's typed
// chat.completions.create — the request needs `modalities` and the response's
// `message.images[].image_url.url` field, neither of which are in the SDK's
// (OpenAI-only) types. The shape here is taken verbatim from OpenRouter's own
// published OpenAPI spec, not guessed.
export async function generateOpenRouterImage(opts: {
  model: string;
  prompt: string;
  referenceImages?: ReferenceImageInput[];
}): Promise<GeneratedImagePart[]> {
  const apiKey = getOpenRouterApiKey();
  if (!apiKey) throw new Error("NO_API_KEY");

  const refs = opts.referenceImages ?? [];
  const content: Array<
    { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }
  > = [];

  // With references attached, an unadorned prompt + trailing images leaves
  // the model to guess whether an image is mood-board inspiration or a
  // strict identity reference — it isn't reliable about assuming the
  // latter on its own. Say so explicitly, label each image right before it
  // appears, and only then give the actual request text.
  if (refs.length) {
    content.push({
      type: "text",
      text:
        "Reference images are attached below, each preceded by a label saying what it shows. Where a label " +
        "identifies a character, that image shows their real appearance — match their face, identity, and " +
        "distinguishing features as closely as you can; only their pose, expression, and the surroundings " +
        "should change to fit the request. Where a label marks a base image to vary, keep its composition and " +
        "subject recognizable while applying the requested change.",
    });
    for (const ref of refs) {
      content.push({ type: "text", text: ref.label });
      content.push({ type: "image_url", image_url: { url: ref.dataUrl } });
    }
    content.push({ type: "text", text: `Request: ${opts.prompt}` });
  } else {
    content.push({ type: "text", text: opts.prompt });
  }

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://magi.local",
      "X-Title": "Magi",
    },
    body: JSON.stringify({
      model: opts.model,
      modalities: ["image", "text"],
      messages: [{ role: "user", content }],
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Image generation failed (${res.status}): ${text.slice(0, 400) || res.statusText}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { images?: Array<{ image_url?: { url?: string } }>; content?: string } }>;
  };
  const images = data.choices?.[0]?.message?.images ?? [];
  const urls = images.map((img) => img.image_url?.url).filter((u): u is string => !!u);
  if (urls.length === 0) {
    const textFallback = data.choices?.[0]?.message?.content;
    throw new Error(
      textFallback
        ? `The model responded with text instead of an image: "${textFallback.slice(0, 200)}"`
        : "The model returned no image."
    );
  }
  return urls.map((dataUrl) => ({ dataUrl }));
}

// Shapes a request to what the specific model actually supports, per its
// live-fetched capabilities. Unknown models (capabilities not yet cached —
// e.g. right after a fresh install before the first refresh) fail open:
// tools stay on and no reasoning override is sent, matching prior behavior
// rather than guessing wrong in the untested direction.
function requestExtras(opts: CompleteOptions): {
  tools: ChatCompletionTool[] | undefined;
  reasoning: { effort: ReasoningEffort } | undefined;
  maxTokens: number;
  plugins: { id: string }[] | undefined;
} {
  const capabilities = getOpenRouterCapabilities(opts.model);
  const wantsTools = !!opts.tools?.length;

  // Magi's own web_search/web_fetch tools need a Tavily key (see
  // lib/tools/webSearch.ts) to actually execute. When one isn't configured,
  // offering the tools would just mean the model calls them and gets an
  // error back — so instead, swap them for OpenRouter's own built-in web
  // plugin, the one point where a tool's availability depends on the
  // destination provider, since only OpenRouter has a built-in substitute.
  const offeredWebSearch = opts.tools?.some((t) => t.name === "web_search");
  const useWebPlugin = offeredWebSearch && !getTavilyApiKey();
  const effectiveTools = useWebPlugin
    ? opts.tools?.filter((t) => t.name !== "web_search" && t.name !== "web_fetch")
    : opts.tools;
  const plugins = useWebPlugin ? [{ id: "web" }] : undefined;

  const tools = wantsTools && capabilities?.supportsTools === false ? undefined : toOpenAITools(effectiveTools);

  let reasoning: { effort: ReasoningEffort } | undefined;
  if (capabilities?.reasoningEfforts.length) {
    const desired = opts.reasoningEffort ?? "low";
    const effort = capabilities.reasoningEfforts.includes(desired)
      ? desired
      : capabilities.reasoningEfforts.find((e) => e === "low") ?? capabilities.reasoningEfforts[0];
    reasoning = { effort };
  }

  const requestedMax = opts.maxTokens ?? 4096;
  const maxTokens = capabilities?.maxCompletionTokens
    ? Math.min(requestedMax, capabilities.maxCompletionTokens)
    : requestedMax;

  return { tools, reasoning, maxTokens, plugins };
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
    const { tools, reasoning, maxTokens, plugins } = requestExtras(opts);
    const working = toWorkingMessages(opts);

    for (let iteration = 0; iteration < (opts.maxToolIterations ?? MAX_TOOL_ITERATIONS); iteration++) {
      const res = await c.chat.completions.create({
        model: opts.model,
        messages: working,
        tools,
        max_tokens: maxTokens,
        ...(reasoning ? { reasoning } : {}),
        ...(plugins ? { plugins } : {}),
      } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming);
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
    const { tools, reasoning, maxTokens, plugins } = requestExtras(opts);
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
          ...(reasoning ? { reasoning } : {}),
          ...(plugins ? { plugins } : {}),
        } as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming,
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
