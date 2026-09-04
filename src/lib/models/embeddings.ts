import { getEmbeddingModelId } from "@/lib/settings";
import {
  OPENROUTER_EMBEDDING_MODELS,
  embedTexts as embedViaOpenRouter,
  openRouterProvider,
} from "@/lib/models/openrouter";
import { localEmbeddingProvider } from "@/lib/models/localEmbeddings";

// The seam between "the archive can search by meaning" and "which vendor is
// currently serving that." Chat has had a provider registry since the
// beginning (src/lib/models/registry.ts); embeddings did not, and imported
// OpenRouter's functions directly from four call sites — which meant the
// semantic half of retrieval was hardwired to one company's continued
// existence and pricing. It is the one dependency whose loss is silent:
// retrieval falls back to keyword matching and simply gets worse.
//
// Everything that needs a vector goes through embedText/embedTexts here.
// Nothing outside this file should import a provider's embedding function.

export interface EmbeddingModelInfo {
  id: string;
  label: string;
  description: string;
}

export interface EmbeddingProvider {
  id: "openrouter" | "local";
  label: string;
  isConfigured(): boolean;
  // Whether this provider serves a given stored model id. Ownership is decided
  // by the id itself rather than by asking each provider's catalog, because a
  // vector row's `model` column has to stay resolvable when the server that
  // listed it is switched off.
  owns(modelId: string): boolean;
  listModels(): Promise<EmbeddingModelInfo[]>;
  embed(model: string, texts: string[]): Promise<number[][]>;
}

const openRouterEmbeddingProvider: EmbeddingProvider = {
  id: "openrouter",
  label: "OpenRouter",
  isConfigured: () => openRouterProvider.isConfigured(),
  // The fallback owner: any id without another provider's prefix. Archives
  // indexed before this file existed store bare OpenRouter ids, and they must
  // keep resolving exactly as they did.
  owns: () => true,
  listModels: async () => OPENROUTER_EMBEDDING_MODELS,
  embed: (model, texts) => embedViaOpenRouter(model, texts),
};

// Order matters: the first provider that claims an id serves it, and
// OpenRouter claims everything, so it goes last.
const PROVIDERS: EmbeddingProvider[] = [localEmbeddingProvider, openRouterEmbeddingProvider];

export function listEmbeddingProviders(): EmbeddingProvider[] {
  return PROVIDERS;
}

export function resolveEmbeddingProvider(modelId: string): EmbeddingProvider | null {
  return PROVIDERS.find((p) => p.owns(modelId)) ?? null;
}

// The gate every embedding call site checks before trying. Replaces the
// `getEmbeddingModelId() && getOpenRouterApiKey()` pair that used to be
// repeated in retrieval, the search index, and the backfill — which silently
// answered "no" for a perfectly working local model.
export function isEmbeddingConfigured(): boolean {
  const modelId = getEmbeddingModelId();
  if (!modelId) return false;
  const provider = resolveEmbeddingProvider(modelId);
  return !!provider?.isConfigured();
}

export async function embedTexts(modelId: string, texts: string[]): Promise<number[][]> {
  if (!texts.length) return [];
  const provider = resolveEmbeddingProvider(modelId);
  if (!provider) throw new Error(`No embedding provider serves "${modelId}".`);
  if (!provider.isConfigured()) throw new Error(`The ${provider.label} embedding provider is not configured.`);
  return provider.embed(modelId, texts);
}

export async function embedText(modelId: string, text: string): Promise<number[]> {
  const [vector] = await embedTexts(modelId, [text]);
  return vector;
}

// Every model the user could currently choose, across configured providers.
// A provider that is configured but unreachable (a local server that isn't
// running) contributes an error rather than disappearing silently — "my model
// list is empty" and "my model list failed to load" need different fixes.
export async function listEmbeddingModels(): Promise<{
  models: EmbeddingModelInfo[];
  providers: Array<{ id: string; label: string; configured: boolean; error: string | null }>;
}> {
  const models: EmbeddingModelInfo[] = [];
  const providers: Array<{ id: string; label: string; configured: boolean; error: string | null }> = [];

  for (const provider of PROVIDERS) {
    const configured = provider.isConfigured();
    let error: string | null = null;
    if (configured) {
      try {
        models.push(...(await provider.listModels()));
      } catch (err) {
        error = err instanceof Error ? err.message : "Could not list models.";
      }
    }
    providers.push({ id: provider.id, label: provider.label, configured, error });
  }
  return { models, providers };
}
