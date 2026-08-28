import { db } from "@/lib/db";
import { anthropicProvider } from "@/lib/models/anthropic";
import type { ModelInfo, ModelProvider, ModelRoleId } from "@/lib/models/types";
import { MODEL_ROLES } from "@/lib/models/types";

// Every provider Magi knows about. Adding a new provider (OpenAI, Gemini,
// a local model) means writing one adapter and registering it here — nothing
// else in the app should ever import a provider SDK directly.
const PROVIDERS: ModelProvider[] = [anthropicProvider];

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

const DEFAULT_ROLE_ASSIGNMENTS: Record<ModelRoleId, string> = {
  default: "claude-sonnet-5",
  reasoner: "claude-opus-4-8",
  writer: "claude-sonnet-5",
  critic: "claude-sonnet-5",
  researcher: "claude-sonnet-5",
  synthesizer: "claude-opus-4-8",
  fast: "claude-haiku-4-5-20251001",
};

export function getRoleAssignments(): Record<ModelRoleId, string> {
  const rows = db.prepare(`SELECT role, model_id FROM model_roles`).all() as Array<{
    role: ModelRoleId;
    model_id: string;
  }>;
  const map = { ...DEFAULT_ROLE_ASSIGNMENTS };
  for (const row of rows) map[row.role] = row.model_id;
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
