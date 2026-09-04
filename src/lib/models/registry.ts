import { db } from "@/lib/db";
import { anthropicProvider } from "@/lib/models/anthropic";
import { openRouterProvider, getOpenRouterCapabilities } from "@/lib/models/openrouter";
import { chutesProvider } from "@/lib/models/chutes";
import type { ModelInfo, ModelProvider, ModelRoleId, ReasoningEffort, TokenUsage } from "@/lib/models/types";
import { MODEL_ROLES, DEFAULT_ROLE_REASONING_EFFORT } from "@/lib/models/types";

// Every provider Magi knows about. Adding a new provider means writing one
// adapter and registering it here — nothing else in the app should ever
// import a provider SDK directly. Chutes is a manual fallback: it competes
// for role assignments in Settings exactly like any other configured
// provider (see pickDefaultModel() below), but nothing here auto-prefers or
// auto-fails-over to it — the user points a role at it by hand.
const DEFAULT_PROVIDERS: ModelProvider[] = [anthropicProvider, openRouterProvider, chutesProvider];
let PROVIDERS: ModelProvider[] = DEFAULT_PROVIDERS;

// Test seam. The pipelines (agent, council, chat turn, episode closing) are the
// part most worth testing and the part that can't be tested against a real
// provider — this lets a suite install a deterministic fake and get the whole
// pipeline exercised for free. Returns a restore function; production code
// never calls it.
export function __setProvidersForTests(providers: ModelProvider[]): () => void {
  const previous = PROVIDERS;
  PROVIDERS = providers;
  return () => {
    PROVIDERS = previous;
  };
}

export function listProviders(): ModelProvider[] {
  return PROVIDERS;
}

export function listAllModels(): ModelInfo[] {
  return PROVIDERS.flatMap((p) => p.models);
}

export function getModel(modelId: string): { provider: ModelProvider; model: ModelInfo } | null {
  for (const provider of PROVIDERS) {
    const model = provider.models.find((m) => m.id === modelId);
    if (model) return { provider, model };
  }
  return null;
}

// Curated fallback used only when no provider is configured yet — the app
// needs to display *something* before the user has set anything up. Once a
// provider is configured, real defaults are picked from its actual catalog
// below rather than from this guess.
const FALLBACK_ROLE_ASSIGNMENTS: Record<ModelRoleId, string> = {
  default: "claude-sonnet-5",
  reasoner: "claude-opus-4-8",
  writer: "claude-sonnet-5",
  critic: "claude-sonnet-5",
  researcher: "claude-sonnet-5",
  synthesizer: "claude-opus-4-8",
  fast: "claude-haiku-4-5-20251001",
};

function pickDefaultModel(role: ModelRoleId): string {
  const configuredModels = PROVIDERS.filter((p) => p.isConfigured()).flatMap((p) => p.models);
  if (configuredModels.length === 0) return FALLBACK_ROLE_ASSIGNMENTS[role];
  const bySpeed = (speed: ModelInfo["speed"]) => configuredModels.find((m) => m.speed === speed);
  if (role === "fast") {
    // "fast" means short, cheap, often shape-constrained turns (the role
    // classifier, the conversation-summary fold) — exactly the workload a
    // mandatory-reasoning model is worst at, since it spends the tight budget
    // on hidden deliberation before any visible answer. guessSpeed() picks
    // "fast" purely from the model id (flash/mini/8b/...), with no idea which
    // of those have mandatory reasoning — so among the fast-speed candidates,
    // prefer one that doesn't. A model with no cached OpenRouter capabilities
    // (Anthropic's own models, or one whose catalog entry hasn't been fetched
    // yet) is treated as fine, matching the fail-open posture requestExtras()
    // already uses for the same missing-data case in openrouter.ts.
    const fastCandidates = configuredModels.filter((m) => m.speed === "fast");
    const nonMandatory = fastCandidates.find((m) => getOpenRouterCapabilities(m.id)?.reasoningMandatory !== true);
    return (nonMandatory ?? fastCandidates[0] ?? configuredModels[0]).id;
  }
  if (role === "reasoner" || role === "synthesizer") return (bySpeed("deep") ?? configuredModels[0]).id;
  return (bySpeed("balanced") ?? configuredModels[0]).id;
}

export function getRoleAssignments(): Record<ModelRoleId, string> {
  const rows = db.prepare(`SELECT role, model_id FROM model_roles`).all() as Array<{
    role: ModelRoleId;
    model_id: string;
  }>;
  const explicit = new Map(rows.map((r) => [r.role, r.model_id]));
  const map = {} as Record<ModelRoleId, string>;
  for (const role of MODEL_ROLES) {
    map[role.id] = explicit.get(role.id) ?? pickDefaultModel(role.id);
  }
  return map;
}

export function setRoleAssignment(role: ModelRoleId, modelId: string) {
  db.prepare(
    `INSERT INTO model_roles (role, model_id) VALUES (?, ?)
     ON CONFLICT(role) DO UPDATE SET model_id = excluded.model_id`
  ).run(role, modelId);
}

export function modelForRole(role: ModelRoleId): string {
  return getRoleAssignments()[role];
}

// Same shape as getRoleAssignments()/setRoleAssignment() above, one table
// over — an explicit per-role choice in Settings takes precedence over the
// DEFAULT_ROLE_REASONING_EFFORT fallback, which itself only covers three
// roles (everything else already implicitly meant "low," per the provider's
// own default — see requestExtras() in openrouter.ts).
export function getReasoningEffortAssignments(): Partial<Record<ModelRoleId, ReasoningEffort>> {
  const rows = db.prepare(`SELECT role, effort FROM role_reasoning_effort`).all() as Array<{
    role: ModelRoleId;
    effort: ReasoningEffort;
  }>;
  const explicit = new Map(rows.map((r) => [r.role, r.effort]));
  const map = {} as Partial<Record<ModelRoleId, ReasoningEffort>>;
  for (const role of MODEL_ROLES) {
    const effort = explicit.get(role.id) ?? DEFAULT_ROLE_REASONING_EFFORT[role.id];
    if (effort) map[role.id] = effort;
  }
  return map;
}

export function setReasoningEffortForRole(role: ModelRoleId, effort: ReasoningEffort) {
  db.prepare(
    `INSERT INTO role_reasoning_effort (role, effort) VALUES (?, ?)
     ON CONFLICT(role) DO UPDATE SET effort = excluded.effort`
  ).run(role, effort);
}

export function reasoningEffortForRole(role: ModelRoleId): ReasoningEffort | undefined {
  return getReasoningEffortAssignments()[role];
}

export function isAnyProviderConfigured(): boolean {
  return PROVIDERS.some((p) => p.isConfigured());
}

const CLASSIFIER_SYSTEM_PROMPT =
  "Classify the task below into exactly one category. Reply with only the category id, nothing else — " +
  "no punctuation, no explanation.\n\n" +
  "default: general conversation, no strong fit for the categories below\n" +
  "reasoner: careful multi-step reasoning, math, logic, planning\n" +
  "writer: drafting or revising prose, creative writing\n" +
  "critic: skeptical review, critique, red-teaming something\n" +
  "researcher: investigation, finding or synthesizing information\n" +
  "synthesizer: reconciling multiple viewpoints or sources into one answer\n" +
  "fast: a quick, simple, low-effort question";

// "Automatic model selection" (Product Vision §29), scoped to conversations —
// Agent pipeline stages and Council roles already get task-appropriate
// routing by construction (see agent.ts/council.ts), so a classifier only
// adds real value where a human currently re-picks a role every turn. Uses an
// actual model call rather than a keyword heuristic, consistent with how the
// rest of this codebase makes judgment calls (Skill/Council selection,
// memory promotion) — never a pattern-matching stand-in for one.
//
// Must never be able to break a conversation turn: any failure (bad reply,
// no API key, network error) falls back to "default" rather than throwing.
export async function classifyModelRole(
  text: string
): Promise<{ role: ModelRoleId; usage: TokenUsage[]; modelId: string; providerId: "anthropic" | "openrouter" | "chutes" }> {
  const modelId = modelForRole("fast");
  const resolved = getModel(modelId);
  const providerId = (resolved?.provider.id as "anthropic" | "openrouter" | "chutes" | undefined) ?? "anthropic";
  const usage: TokenUsage[] = [];
  if (!resolved || !resolved.provider.isConfigured()) {
    return { role: "default", usage, modelId, providerId };
  }
  try {
    const reply = await resolved.provider.complete({
      model: modelId,
      system: CLASSIFIER_SYSTEM_PROMPT,
      // Generous despite the tiny expected answer: some models have
      // *mandatory* reasoning they can't be told to skip (see "Lessons
      // learned" in docs/Handoff.md) and will spend a small budget entirely
      // on hidden reasoning tokens, never reaching the actual word. Verified
      // live — 10 tokens produced empty answers on qwen3.8-flash; one call
      // at 200 used the entire budget on reasoning alone. Raised again after
      // verifying meta/muse-spark-1.2-contributor live: it spent 297 of a
      // 300-token budget on reasoning and returned nothing in either content
      // or the reasoning field (worse than qwen3.8-flash, which at least left
      // text in the reasoning field for extractText()'s fallback to catch);
      // the same prompt needed ~800 reasoning tokens to reach a real answer.
      // No budget is guaranteed safe forever against mandatory reasoning of
      // unknown length, but cost is a fraction of a cent either way, so a
      // wide margin over what was actually measured is cheap insurance.
      maxTokens: 1000,
      messages: [{ role: "user", content: text.slice(0, 2000) }],
      usage,
    });
    // Search rather than exact-match: models don't reliably reply with the
    // bare id even when told to — take the first role id mentioned anywhere
    // in the reply.
    const lower = reply.toLowerCase();
    const role = MODEL_ROLES.find((r) => new RegExp(`\\b${r.id}\\b`).test(lower))?.id;
    return { role: role ?? "default", usage, modelId, providerId };
  } catch {
    return { role: "default", usage, modelId, providerId };
  }
}

export { MODEL_ROLES };
