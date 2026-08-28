import { NextRequest, NextResponse } from "next/server";
import { search } from "@/lib/searchIndex";
import type { SearchKind } from "@/lib/searchIndex";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q") ?? "";
  const projectId = req.nextUrl.searchParams.get("projectId") ?? undefined;
  const kindsParam = req.nextUrl.searchParams.get("kinds");
  const kinds = kindsParam ? (kindsParam.split(",") as SearchKind[]) : undefined;
  try {
    return NextResponse.json({ results: search(q, { projectId, kinds }) });
  } catch {
    return NextResponse.json({ results: [] });
  }
}
