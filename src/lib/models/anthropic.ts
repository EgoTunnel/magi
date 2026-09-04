import Anthropic from "@anthropic-ai/sdk";
import { getAnthropicApiKey } from "@/lib/settings";
import type { CompleteOptions, ModelInfo, ModelMessage, ModelProvider, StreamEvent, ToolSpec } from "@/lib/models/types";

const MODELS: ModelInfo[] = [
  {
    id: "claude-opus-4-8",
    provider: "anthropic",
    label: "Claude Opus 4.8",
    description: "Deepest reasoning, highest cost",
    speed: "deep",
    supportsVision: true,
  },
  {
    id: "claude-sonnet-5",
    provider: "anthropic",
    label: "Claude Sonnet 5",
    description: "Balanced capability and speed",
    speed: "balanced",
    supportsVision: true,
  },
  {
    id: "claude-haiku-4-5-20251001",
    provider: "anthropic",
    label: "Claude Haiku 4.5",
    description: "Fast and inexpensive",
    speed: "fast",
    supportsVision: true,
  },
  {
    id: "claude-fable-5",
    provider: "anthropic",
    label: "Claude Fable 5",
    description: "Creative and narrative work",
    speed: "balanced",
    supportsVision: true,
  },
];

// A tool round-trip (Magi executing a tool and handing the result back) counts
// as one iteration. This bounds runaway loops if a model keeps calling tools.
const MAX_TOOL_ITERATIONS = 10;

// Below this, a cache breakpoint is not worth placing: Anthropic ignores a
// cached prefix shorter than its per-model minimum (1,024 tokens on most
// models, 2,048 on the smaller ones) and bills the whole prompt normally. This
// is that ceiling in characters, with margin — roughly 3.5 characters per
// token, deliberately conservative so a marked prefix is really over the line.
const CACHE_MIN_CHARS = 9000;

// The three functions below are exported for tests only. Nothing outside this
// module should call them: caching is a property of how this provider builds a
// request, not something a caller configures.
export function contentLength(content: Anthropic.MessageParam["content"]): number {
  if (typeof content === "string") return content.length;
  return content.reduce((n, block) => n + (block.type === "text" ? block.text.length : 0), 0);
}

// Marks a message as the end of a cacheable prefix, in place. Everything from
// the start of the request up to and including this message is then stored by
// the provider and re-read on the next call instead of being reprocessed —
// which for a conversation means its whole history, since Magi sends the
// earlier turns byte-identical every time (this turn's retrieved passages ride
// on the *last* message, deliberately: see withTurnContext in chatTurn.ts).
export function markCacheBreakpoint(message: Anthropic.MessageParam) {
  const cacheControl = { type: "ephemeral" as const };
  if (typeof message.content === "string") {
    // An empty text block is rejected outright, so a message with no text is
    // simply left unmarked — the next call just misses the cache.
    if (!message.content) return;
    message.content = [{ type: "text", text: message.content, cache_control: cacheControl }];
    return;
  }
  const last = message.content[message.content.length - 1];
  if (last) Object.assign(last, { cache_control: cacheControl });
}

// The system prompt as a cacheable block when it is big enough to be worth
// caching, and as a plain string when it isn't. Magi's system prompt carries
// the Project, its memory, its roster and the conversation's rolling summary —
// identical from one turn to the next, and thousands of tokens of it.
export function systemParam(
  system: string | undefined,
  cache: boolean
): string | Anthropic.TextBlockParam[] | undefined {
  if (!system) return undefined;
  if (!cache || system.length < CACHE_MIN_CHARS) return system;
  return [{ type: "text", text: system, cache_control: { type: "ephemeral" } }];
}

export function usageOf(usage: Anthropic.Usage) {
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  return {
    // input_tokens excludes both cache figures, so they are added back: the
    // turn really did put that many tokens in front of the model, and a
    // conversation's token counts shouldn't appear to collapse just because
    // the prefix started being cached.
    promptTokens: usage.input_tokens + cacheRead + cacheWrite,
    completionTokens: usage.output_tokens,
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
  };
}

function client() {
  const apiKey = getAnthropicApiKey();
  if (!apiKey) throw new Error("NO_API_KEY");
  return new Anthropic({ apiKey });
}

function toAnthropicTools(tools?: ToolSpec[]): Anthropic.Tool[] | undefined {
  if (!tools || !tools.length) return undefined;
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
  }));
}

function toAnthropicContent(content: ModelMessage["content"]): string | Anthropic.ContentBlockParam[] {
  if (typeof content === "string") return content;
  return content.map((part): Anthropic.ContentBlockParam =>
    part.type === "image"
      ? {
          type: "image",
          source: { type: "base64", media_type: part.mimeType as Anthropic.Base64ImageSource["media_type"], data: part.dataBase64! },
        }
      : { type: "text", text: part.text ?? "" }
  );
}

function toWorkingMessages(messages: ModelMessage[]): Anthropic.MessageParam[] {
  return messages.map((m) => ({ role: m.role, content: toAnthropicContent(m.content) }));
}

async function resolveToolCalls(
  opts: CompleteOptions,
  content: Anthropic.ContentBlock[]
): Promise<Anthropic.ToolResultBlockParam[]> {
  const toolUseBlocks = content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  const results: Anthropic.ToolResultBlockParam[] = [];
  for (const block of toolUseBlocks) {
    const result = opts.onToolCall ? await opts.onToolCall(block.name, block.input) : "(no tool executor configured)";
    opts.toolLog?.push({ name: block.name, input: block.input, result });
    results.push({ type: "tool_result", tool_use_id: block.id, content: result });
  }
  return results;
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
    const tools = toAnthropicTools(opts.tools);
    const working: Anthropic.MessageParam[] = toWorkingMessages(opts.messages);

    for (let iteration = 0; iteration < (opts.maxToolIterations ?? MAX_TOOL_ITERATIONS); iteration++) {
      const res = await c.messages.create({
        model: opts.model,
        system: opts.system,
        max_tokens: opts.maxTokens ?? 2048,
        messages: working,
        tools,
      });

      // Every iteration is a real, separately-billed API call — including tool-use
      // round trips — so usage is recorded here, not just on the final answer.
      opts.usage?.push(usageOf(res.usage));

      if (res.stop_reason === "tool_use") {
        const toolResults = await resolveToolCalls(opts, res.content);
        working.push({ role: "assistant", content: res.content });
        working.push({ role: "user", content: toolResults });
        continue;
      }

      const block = res.content.find((b) => b.type === "text");
      return block && block.type === "text" ? block.text : "";
    }
    return "(Magi stopped calling tools after reaching this turn's limit, without a final answer.)";
  },
  async *stream(opts: CompleteOptions) {
    const c = client();
    const tools = toAnthropicTools(opts.tools);
    const working: Anthropic.MessageParam[] = toWorkingMessages(opts.messages);

    // Conversation turns, and only conversation turns, reach this method — the
    // one workload where the same enormous prefix is sent over and over. Two
    // breakpoints: the end of the system prompt, and the end of the last
    // message before the live one. Marked once, on the prefix, so they survive
    // as tool results grow `working` below.
    //
    // The marks are advisory. A prefix that has changed, or that falls under
    // the provider's minimum, is simply a cache miss and costs what it always
    // did — there is no failure mode here beyond paying the old price.
    const prefix = working.slice(0, -1);
    if (prefix.length && prefix.reduce((n, m) => n + contentLength(m.content), 0) >= CACHE_MIN_CHARS) {
      markCacheBreakpoint(prefix[prefix.length - 1]);
    }
    const system = systemParam(opts.system, true);

    for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
      const stream = c.messages.stream(
        {
          model: opts.model,
          system,
          max_tokens: opts.maxTokens ?? 4096,
          messages: working,
          tools,
        },
        { signal: opts.signal }
      );
      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          yield { type: "text", text: event.delta.text } satisfies StreamEvent;
        }
      }

      const final = await stream.finalMessage();
      opts.usage?.push(usageOf(final.usage));
      if (final.stop_reason === "tool_use") {
        const toolUseBlocks = final.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
        for (const block of toolUseBlocks) yield { type: "tool_start", name: block.name } satisfies StreamEvent;
        const toolResults = await resolveToolCalls(opts, final.content);
        for (const block of toolUseBlocks) yield { type: "tool_end", name: block.name } satisfies StreamEvent;
        working.push({ role: "assistant", content: final.content });
        working.push({ role: "user", content: toolResults });
        continue;
      }
      return;
    }
  },
};
