import Anthropic from "@anthropic-ai/sdk";
import { getAnthropicApiKey } from "@/lib/settings";
import type { CompleteOptions, ModelInfo, ModelProvider } from "@/lib/models/types";

const MODELS: ModelInfo[] = [
  {
    id: "claude-opus-4-8",
    provider: "anthropic",
    label: "Claude Opus 4.8",
    description: "Deepest reasoning, highest cost",
    speed: "deep",
  },
  {
    id: "claude-sonnet-5",
    provider: "anthropic",
    label: "Claude Sonnet 5",
    description: "Balanced capability and speed",
    speed: "balanced",
  },
  {
    id: "claude-haiku-4-5-20251001",
    provider: "anthropic",
    label: "Claude Haiku 4.5",
    description: "Fast and inexpensive",
    speed: "fast",
  },
  {
    id: "claude-fable-5",
    provider: "anthropic",
    label: "Claude Fable 5",
    description: "Creative and narrative work",
    speed: "balanced",
  },
];

function client() {
  const apiKey = getAnthropicApiKey();
  if (!apiKey) throw new Error("NO_API_KEY");
  return new Anthropic({ apiKey });
}

export const anthropicProvider: ModelProvider = {
  id: "anthropic",
  label: "Anthropic",
  models: MODELS,
  isConfigured() {
    return !!getAnthropicApiKey();
  },
  async complete(opts: CompleteOptions) {
    const c = client();
    const res = await c.messages.create({
      model: opts.model,
      system: opts.system,
      max_tokens: opts.maxTokens ?? 2048,
      messages: opts.messages.map((m) => ({ role: m.role, content: m.content })),
    });
    const block = res.content.find((b) => b.type === "text");
    return block && block.type === "text" ? block.text : "";
  },
  async *stream(opts: CompleteOptions) {
    const c = client();
    const stream = c.messages.stream({
      model: opts.model,
      system: opts.system,
      max_tokens: opts.maxTokens ?? 4096,
      messages: opts.messages.map((m) => ({ role: m.role, content: m.content })),
    });
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        yield event.delta.text;
      }
    }
  },
};
