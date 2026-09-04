import OpenAI from "openai";
import { getLocalEmbeddingBaseUrl } from "@/lib/settings";
import { embedViaOpenAI } from "@/lib/models/openaiCompatible";
import type { EmbeddingModelInfo, EmbeddingProvider } from "@/lib/models/embeddings";

// Embeddings served by an OpenAI-compatible server on this machine — Ollama,
// LM Studio, or anything else of that shape. One adapter covers all of them,
// which is the whole reason the OpenAI-compatible API shape is worth targeting.
//
// This is the provider that makes the archive's semantic half survive a vendor
// change. Everything else Magi does degrades gracefully when a remote provider
// goes away; retrieval quietly drops to keyword matching, which looks like the
// archive getting worse rather than a provider being unreachable.

// Ollama and LM Studio both ignore the key, but the OpenAI SDK refuses to
// construct a client without one.
const PLACEHOLDER_KEY = "local";

function client(baseURL: string) {
  return new OpenAI({ apiKey: PLACEHOLDER_KEY, baseURL });
}

// A local model id is stored with this prefix and a remote one without, which
// is what lets a single stored `embedding_model_id` (and the `model` column on
// every vector row) say unambiguously who should serve it. Prefixing only the
// local side is deliberate: archives indexed before local embeddings existed
// hold bare OpenRouter ids, and renaming those would orphan every vector in
// them.
export const LOCAL_PREFIX = "local:";

export function isLocalModelId(modelId: string): boolean {
  return modelId.startsWith(LOCAL_PREFIX);
}

export function stripLocalPrefix(modelId: string): string {
  return modelId.slice(LOCAL_PREFIX.length);
}

// OpenAI-compatible servers expose their catalog at /v1/models, but none of
// them say which entries can embed — Ollama lists chat models and embedding
// models side by side with no distinguishing field. So this returns everything
// and the UI says plainly that picking a chat model here will fail. Guessing
// from name substrings ("embed", "bge", "nomic") would silently hide a working
// model whose name doesn't match the pattern.
async function listModels(): Promise<EmbeddingModelInfo[]> {
  const baseURL = getLocalEmbeddingBaseUrl();
  if (!baseURL) return [];
  const res = await fetch(`${baseURL}/models`, { headers: { Authorization: `Bearer ${PLACEHOLDER_KEY}` } });
  if (!res.ok) throw new Error(`Local embedding server returned ${res.status} for ${baseURL}/models`);
  const body = (await res.json()) as { data?: Array<{ id?: string }> };
  return (body.data ?? [])
    .map((m) => m.id)
    .filter((id): id is string => typeof id === "string" && id.length > 0)
    .sort()
    .map((id) => ({
      id: `${LOCAL_PREFIX}${id}`,
      label: `${id} (local)`,
      description: "Served locally — no network, no vendor",
    }));
}

export const localEmbeddingProvider: EmbeddingProvider = {
  id: "local",
  label: "Local (OpenAI-compatible)",
  isConfigured: () => !!getLocalEmbeddingBaseUrl(),
  owns: isLocalModelId,
  listModels,
  async embed(model, texts) {
    const baseURL = getLocalEmbeddingBaseUrl();
    if (!baseURL) throw new Error("NO_LOCAL_EMBEDDING_URL");
    return embedViaOpenAI(client(baseURL), stripLocalPrefix(model), texts);
  },
};
