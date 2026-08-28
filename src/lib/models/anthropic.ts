import Anthropic from "@anthropic-ai/sdk";
import { getAnthropicApiKey } from "@/lib/settings";
import type { CompleteOptions, ModelInfo, ModelProvider, ToolSpec } from "@/lib/models/types";

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
    const working: Anthropic.MessageParam[] = opts.messages.map((m) => ({ role: m.role, content: m.content }));

    for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
      const res = await c.messages.create({
        model: opts.model,
        system: opts.system,
        max_tokens: opts.maxTokens ?? 2048,
        messages: working,
        tools,
      });

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
    const working: Anthropic.MessageParam[] = opts.messages.map((m) => ({ role: m.role, content: m.content }));

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
