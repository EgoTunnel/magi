import { NextResponse } from "next/server";
import { listEmbeddingModels } from "@/lib/models/embeddings";

export async function GET() {
  const { models, providers } = await listEmbeddingModels();
  return NextResponse.json({
    models,
    providers,
    // Kept for the Settings page's existing check: is there any provider that
    // could serve an embedding at all.
    configured: providers.some((p) => p.configured),
  });
}
