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
