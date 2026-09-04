import { NextRequest, NextResponse } from "next/server";
import {
  getSetting,
  setSetting,
  deleteSetting,
  getCrossProjectSearchEnabled,
  setCrossProjectSearchEnabled,
  getEmbeddingModelId,
  setEmbeddingModelId,
  getLocalEmbeddingBaseUrl,
  setLocalEmbeddingBaseUrl,
  getDisabledTools,
  setDisabledTools,
} from "@/lib/settings";
import { isAnyProviderConfigured } from "@/lib/models/registry";
import { refreshOpenRouterModels, getCachedOpenRouterModels } from "@/lib/models/openrouter";
import { refreshChutesModels, getCachedChutesModels } from "@/lib/models/chutes";
import { TOOL_SPECS } from "@/lib/tools/registry";

function preview(key: string | null): string | null {
  return key ? `${"•".repeat(Math.max(key.length - 4, 0))}${key.slice(-4)}` : null;
}

export async function GET() {
  const anthropicKey = getSetting("anthropic_api_key");
  const openRouterKey = getSetting("openrouter_api_key");
  const chutesKey = getSetting("chutes_api_key");
  const tavilyKey = getSetting("tavily_api_key");
  const { models, fetchedAt } = getCachedOpenRouterModels();
  const { models: chutesModels, fetchedAt: chutesFetchedAt } = getCachedChutesModels();
  return NextResponse.json({
    anthropicKeySet: !!anthropicKey || !!process.env.ANTHROPIC_API_KEY,
    anthropicKeyPreview: preview(anthropicKey),
    openRouterKeySet: !!openRouterKey || !!process.env.OPENROUTER_API_KEY,
    openRouterKeyPreview: preview(openRouterKey),
    chutesKeySet: !!chutesKey || !!process.env.CHUTES_API_KEY,
    chutesKeyPreview: preview(chutesKey),
    tavilyKeySet: !!tavilyKey || !!process.env.TAVILY_API_KEY,
    tavilyKeyPreview: preview(tavilyKey),
    openRouterModelCount: models.length,
    openRouterModelsFetchedAt: fetchedAt,
    chutesModelCount: chutesModels.length,
    chutesModelsFetchedAt: chutesFetchedAt,
    configured: isAnyProviderConfigured(),
    crossProjectSearchEnabled: getCrossProjectSearchEnabled(),
    embeddingModelId: getEmbeddingModelId(),
    localEmbeddingBaseUrl: getLocalEmbeddingBaseUrl(),
    tools: TOOL_SPECS.map((t) => ({ name: t.name, description: t.description })),
    disabledTools: getDisabledTools(),
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json();

  if (typeof body.anthropicApiKey === "string") {
    if (body.anthropicApiKey.trim()) {
      setSetting("anthropic_api_key", body.anthropicApiKey.trim());
    } else {
      deleteSetting("anthropic_api_key");
    }
  }

  let openRouterRefreshError: string | null = null;
  if (typeof body.openRouterApiKey === "string") {
    if (body.openRouterApiKey.trim()) {
      setSetting("openrouter_api_key", body.openRouterApiKey.trim());
      // Populate the model catalog immediately so role defaults have something real to pick from.
      try {
        await refreshOpenRouterModels();
      } catch (err) {
        openRouterRefreshError = err instanceof Error ? err.message : "Could not load the OpenRouter model list.";
      }
    } else {
      deleteSetting("openrouter_api_key");
    }
  }

  let chutesRefreshError: string | null = null;
  if (typeof body.chutesApiKey === "string") {
    if (body.chutesApiKey.trim()) {
      setSetting("chutes_api_key", body.chutesApiKey.trim());
      // Populate the model catalog immediately so role defaults have something real to pick from.
      try {
        await refreshChutesModels();
      } catch (err) {
        chutesRefreshError = err instanceof Error ? err.message : "Could not load the Chutes model list.";
      }
    } else {
      deleteSetting("chutes_api_key");
    }
  }

  if (typeof body.tavilyApiKey === "string") {
    if (body.tavilyApiKey.trim()) {
      setSetting("tavily_api_key", body.tavilyApiKey.trim());
    } else {
      deleteSetting("tavily_api_key");
    }
  }

  if (typeof body.crossProjectSearchEnabled === "boolean") {
    setCrossProjectSearchEnabled(body.crossProjectSearchEnabled);
  }

  if (typeof body.embeddingModelId === "string" && body.embeddingModelId.trim()) {
    setEmbeddingModelId(body.embeddingModelId.trim());
  }

  if (typeof body.localEmbeddingBaseUrl === "string") {
    if (body.localEmbeddingBaseUrl.trim()) {
      setLocalEmbeddingBaseUrl(body.localEmbeddingBaseUrl.trim());
    } else {
      deleteSetting("local_embedding_base_url");
    }
  }

  if (Array.isArray(body.disabledTools)) {
    setDisabledTools(body.disabledTools.filter((t: unknown): t is string => typeof t === "string"));
  }

  return NextResponse.json({ ok: true, openRouterRefreshError, chutesRefreshError });
}
