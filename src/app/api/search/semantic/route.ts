import { NextRequest, NextResponse } from "next/server";
import { semanticSearch } from "@/lib/searchIndex";
import type { SearchKind } from "@/lib/searchIndex";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q") ?? "";
  const projectId = req.nextUrl.searchParams.get("projectId") ?? undefined;
  const kindsParam = req.nextUrl.searchParams.get("kinds");
  const kinds = kindsParam ? (kindsParam.split(",") as SearchKind[]) : undefined;
  try {
    return NextResponse.json({ results: await semanticSearch(q, { projectId, kinds }) });
  } catch (err) {
    if (err instanceof Error && err.message === "NO_EMBEDDING_MODEL") {
      return NextResponse.json(
        {
          error: "NO_EMBEDDING_MODEL",
          message: "No embedding model configured. Add an OpenRouter key and pick a model in Settings to search by meaning.",
        },
        { status: 412 }
      );
    }
    return NextResponse.json({ results: [] });
  }
}
