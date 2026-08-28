import { db } from "@/lib/db";
import { anthropicProvider } from "@/lib/models/anthropic";
import { openRouterProvider } from "@/lib/models/openrouter";
import type { ModelInfo, ModelProvider, ModelRoleId } from "@/lib/models/types";
import { MODEL_ROLES } from "@/lib/models/types";

// Every provider Magi knows about. Adding a new provider means writing one
// adapter and registering it here — nothing else in the app should ever
// import a provider SDK directly.
const PROVIDERS: ModelProvider[] = [anthropicProvider, openRouterProvider];

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
  if (role === "fast") return (bySpeed("fast") ?? configuredModels[0]).id;
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

export function isAnyProviderConfigured(): boolean {
  return PROVIDERS.some((p) => p.isConfigured());
}

export { MODEL_ROLES };
