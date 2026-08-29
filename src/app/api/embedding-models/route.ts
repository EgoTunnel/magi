import { NextResponse } from "next/server";
import { getCachedOpenRouterEmbeddingModels } from "@/lib/models/openrouter";
import { getOpenRouterApiKey } from "@/lib/settings";

export async function GET() {
  const { models } = getCachedOpenRouterEmbeddingModels();
  return NextResponse.json({ models, configured: !!getOpenRouterApiKey() });
}
