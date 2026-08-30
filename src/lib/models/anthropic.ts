import Anthropic from "@anthropic-ai/sdk";
import { getAnthropicApiKey } from "@/lib/settings";
import type { CompleteOptions, ModelInfo, ModelMessage, ModelProvider, ToolSpec } from "@/lib/models/types";

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

    for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
      const res = await c.messages.create({
        model: opts.model,
        system: opts.system,
        max_tokens: opts.maxTokens ?? 2048,
        messages: working,
        tools,
      });

      // Every iteration is a real, separately-billed API call — including tool-use
      // round trips — so usage is recorded here, not just on the final answer.
      opts.usage?.push({ promptTokens: res.usage.input_tokens, completionTokens: res.usage.output_tokens });

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

    for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
      const stream = c.messages.stream({
        model: opts.model,
        system: opts.system,
        max_tokens: opts.maxTokens ?? 4096,
        messages: working,
        tools,
      });
      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          yield event.delta.text;
        }
      }

      const final = await stream.finalMessage();
      opts.usage?.push({ promptTokens: final.usage.input_tokens, completionTokens: final.usage.output_tokens });
      if (final.stop_reason === "tool_use") {
        const toolResults = await resolveToolCalls(opts, final.content);
        working.push({ role: "assistant", content: final.content });
        working.push({ role: "user", content: toolResults });
        continue;
      }
      return;
    }
  },
};
