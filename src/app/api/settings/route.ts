import { NextRequest, NextResponse } from "next/server";
import {
  getSetting,
  setSetting,
  deleteSetting,
  getCrossProjectSearchEnabled,
  setCrossProjectSearchEnabled,
  getEmbeddingModelId,
  setEmbeddingModelId,
  getDisabledTools,
  setDisabledTools,
} from "@/lib/settings";
import { isAnyProviderConfigured } from "@/lib/models/registry";
import { refreshOpenRouterModels, getCachedOpenRouterModels } from "@/lib/models/openrouter";
import { TOOL_SPECS } from "@/lib/tools/registry";

function preview(key: string | null): string | null {
  return key ? `${"•".repeat(Math.max(key.length - 4, 0))}${key.slice(-4)}` : null;
}

export async function GET() {
  const anthropicKey = getSetting("anthropic_api_key");
  const openRouterKey = getSetting("openrouter_api_key");
  const { models, fetchedAt } = getCachedOpenRouterModels();
  return NextResponse.json({
    anthropicKeySet: !!anthropicKey || !!process.env.ANTHROPIC_API_KEY,
    anthropicKeyPreview: preview(anthropicKey),
    openRouterKeySet: !!openRouterKey || !!process.env.OPENROUTER_API_KEY,
    openRouterKeyPreview: preview(openRouterKey),
    openRouterModelCount: models.length,
    openRouterModelsFetchedAt: fetchedAt,
    configured: isAnyProviderConfigured(),
    crossProjectSearchEnabled: getCrossProjectSearchEnabled(),
    embeddingModelId: getEmbeddingModelId(),
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

  if (typeof body.crossProjectSearchEnabled === "boolean") {
    setCrossProjectSearchEnabled(body.crossProjectSearchEnabled);
  }

  if (typeof body.embeddingModelId === "string" && body.embeddingModelId.trim()) {
    setEmbeddingModelId(body.embeddingModelId.trim());
  }

  if (Array.isArray(body.disabledTools)) {
    setDisabledTools(body.disabledTools.filter((t: unknown): t is string => typeof t === "string"));
  }

  return NextResponse.json({ ok: true, openRouterRefreshError });
}
