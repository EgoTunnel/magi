import { __setProvidersForTests } from "@/lib/models/registry";
import { setRoleAssignment } from "@/lib/models/registry";
import { MODEL_ROLES } from "@/lib/models/types";
import type {
  CompleteOptions,
  ModelInfo,
  ModelProvider,
  StreamEvent,
  ToolCallRecord,
} from "@/lib/models/types";

export interface RecordedCall {
  model: string;
  system: string;
  prompt: string;
  maxTokens?: number;
  toolNames: string[];
}

export interface MockProvider {
  provider: ModelProvider;
  calls: RecordedCall[];
  restore: () => void;
  /** Queue a reply for the next call. Replies are consumed in order. */
  reply: (text: string) => void;
  /** Reply to every call not covered by a queued reply. */
  setDefaultReply: (text: string | ((opts: CompleteOptions) => string)) => void;
  /** Make the next call reject, to exercise a failure path. */
  failNext: (message: string) => void;
  /** Ask for a tool to be called on the next completion, then reply with `then`. */
  callToolNext: (name: string, input: unknown, then: string) => void;
}

const MODELS: ModelInfo[] = MODEL_ROLES.map((role, i) => ({
  id: `mock-${role.id}`,
  provider: "openrouter" as const,
  label: `Mock ${role.label}`,
  description: "deterministic test model",
  speed: i === 0 ? ("balanced" as const) : ("fast" as const),
  supportsTools: true,
  supportsVision: true,
}));

function promptOf(opts: CompleteOptions): string {
  const last = opts.messages[opts.messages.length - 1];
  if (!last) return "";
  return typeof last.content === "string"
    ? last.content
    : last.content.map((p) => p.text ?? `[${p.type}]`).join("\n");
}

// A provider that never touches the network, records what it was asked, and
// replies with whatever the test queued. This is what makes the pipelines —
// the part of Magi most worth testing and least testable against a real model
// — checkable at all.
export function installMockProvider(): MockProvider {
  const calls: RecordedCall[] = [];
  const queued: string[] = [];
  const failures: string[] = [];
  const toolRequests: Array<{ name: string; input: unknown; then: string }> = [];
  let defaultReply: string | ((opts: CompleteOptions) => string) = "mock reply";

  async function complete(opts: CompleteOptions): Promise<string> {
    calls.push({
      model: opts.model,
      system: opts.system ?? "",
      prompt: promptOf(opts),
      maxTokens: opts.maxTokens,
      toolNames: (opts.tools ?? []).map((t) => t.name),
    });
    opts.usage?.push({ promptTokens: 10, completionTokens: 5 });

    const failure = failures.shift();
    if (failure) throw new Error(failure);

    const toolRequest = toolRequests.shift();
    if (toolRequest && opts.onToolCall) {
      const result = await opts.onToolCall(toolRequest.name, toolRequest.input);
      const record: ToolCallRecord = { name: toolRequest.name, input: toolRequest.input, result };
      opts.toolLog?.push(record);
      return toolRequest.then;
    }

    const next = queued.shift();
    if (next !== undefined) return next;
    return typeof defaultReply === "function" ? defaultReply(opts) : defaultReply;
  }

  const provider: ModelProvider = {
    id: "openrouter",
    label: "Mock",
    models: MODELS,
    isConfigured: () => true,
    complete,
    async *stream(opts: CompleteOptions): AsyncGenerator<StreamEvent, void, unknown> {
      const text = await complete(opts);
      yield { type: "text", text };
    },
  };

  const restoreProviders = __setProvidersForTests([provider]);
  // Pin every role to a mock model so nothing falls through to a real catalog.
  for (const role of MODEL_ROLES) setRoleAssignment(role.id, `mock-${role.id}`);

  return {
    provider,
    calls,
    restore: restoreProviders,
    reply: (text) => queued.push(text),
    setDefaultReply: (text) => {
      defaultReply = text;
    },
    failNext: (message) => failures.push(message),
    callToolNext: (name, input, then) => toolRequests.push({ name, input, then }),
  };
}
