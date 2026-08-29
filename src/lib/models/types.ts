export interface ModelMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ModelInfo {
  id: string;
  provider: "anthropic" | "openrouter";
  label: string;
  description: string;
  speed: "fast" | "balanced" | "deep";
  // Whether this model can be sent tool definitions at all. Anthropic models
  // are assumed true; OpenRouter models are set from the live catalog.
  // Undefined means unknown (capabilities not fetched yet) — treated as true
  // so nothing regresses before the first catalog refresh.
  supportsTools?: boolean;
}

export type ReasoningEffort = "none" | "low" | "medium" | "high" | "max" | "xhigh";

// What a specific model actually supports, fetched from the provider's own
// catalog rather than assumed. This is the mechanism that lets Magi stay
// correct across arbitrary OpenRouter models without a code change per model:
// the *shape* of what varies (tool support, reasoning behavior, output
// ceiling) is fixed, even though *which* models fall where isn't.
export interface ModelCapabilities {
  supportsTools: boolean;
  reasoningMandatory: boolean;
  reasoningEfforts: ReasoningEffort[];
  maxCompletionTokens: number | null;
  // Dollars per token, read from OpenRouter's own catalog (never guessed).
  // Null when the model is free or pricing wasn't reported.
  pricePerPromptToken: number | null;
  pricePerCompletionToken: number | null;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
}

// A tool Magi's model layer can call mid-turn. The model only ever sees
// name/description/inputSchema; execution happens in Magi's tool layer
// (src/lib/tools), never inside the provider itself — see Product Vision §32.
export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface ToolCallRecord {
  name: string;
  input: unknown;
  result: string;
}

export interface CompleteOptions {
  model: string;
  system?: string;
  messages: ModelMessage[];
  maxTokens?: number;
  tools?: ToolSpec[];
  onToolCall?: (name: string, input: unknown) => Promise<string>;
  toolLog?: ToolCallRecord[];
  // How hard a model should think before answering, where the model supports
  // saying so. Unset defaults to "low" for providers where reasoning is
  // otherwise mandatory-and-unbounded — see openrouter.ts. Some current
  // models spend their *entire* turn "thinking" and never emit a visible
  // answer unless this is turned down; this is the real fix for that class
  // of failure, not just a bigger token budget.
  reasoningEffort?: ReasoningEffort;
  // Out-param a provider pushes exactly one entry into after a call resolves —
  // same shape as toolLog. Needed because stream()'s return type only ever
  // carries yielded text chunks, not a final value, so usage has to leave via
  // a side channel rather than a return value.
  usage?: TokenUsage[];
}

export interface ModelProvider {
  id: string;
  label: string;
  models: ModelInfo[];
  isConfigured(): boolean;
  complete(opts: CompleteOptions): Promise<string>;
  stream(opts: CompleteOptions): AsyncGenerator<string, void, unknown>;
}

// A "role" is what the rest of Magi should reference — never a raw model id.
// This is the mechanism by which the model layer stays replaceable: Skills,
// Councils, and conversations ask for "the reasoner" or "the writer," and a
// model is assigned to that role in Settings. Swap the assignment, and every
// caller upgrades without being touched.
export const MODEL_ROLES = [
  { id: "default", label: "Default", description: "General-purpose conversation" },
  { id: "reasoner", label: "Reasoner", description: "Careful multi-step reasoning" },
  { id: "writer", label: "Writer", description: "Prose, drafting, editorial work" },
  { id: "critic", label: "Critic", description: "Skeptical review and red-teaming" },
  { id: "researcher", label: "Researcher", description: "Investigation and synthesis" },
  { id: "synthesizer", label: "Synthesizer", description: "Reconciling multiple analyses" },
  { id: "fast", label: "Fast", description: "Quick, inexpensive turns" },
] as const;

export type ModelRoleId = (typeof MODEL_ROLES)[number]["id"];

export const REASONING_EFFORTS: ReasoningEffort[] = ["none", "low", "medium", "high", "xhigh", "max"];

// Deeper roles get more room to think; everything else defaults to "low" at
// the provider level, which is what most conversational and agentic turns
// actually want — fast, direct answers rather than long hidden deliberation.
// This is only the *fallback* for a role with no explicit user assignment —
// see getReasoningEffortAssignments() in registry.ts, which is what callers
// should actually use. Only takes effect for OpenRouter-assigned models;
// Anthropic's provider doesn't wire up an equivalent effort control.
export const DEFAULT_ROLE_REASONING_EFFORT: Partial<Record<ModelRoleId, ReasoningEffort>> = {
  reasoner: "high",
  synthesizer: "high",
  researcher: "medium",
};
