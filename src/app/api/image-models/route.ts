import { NextResponse } from "next/server";
import { getCachedOpenRouterImageModels } from "@/lib/models/openrouter";
import { getOpenRouterApiKey } from "@/lib/settings";

export async function GET() {
  const { models, fetchedAt } = getCachedOpenRouterImageModels();
  return NextResponse.json({ models, fetchedAt, configured: !!getOpenRouterApiKey() });
}
