import { NextResponse } from "next/server";
import { getCurationStatus, listUncuratedImports, runImportCuration } from "@/lib/importCuration";

export async function GET() {
  return NextResponse.json({ status: getCurationStatus(), pending: listUncuratedImports().length });
}

export async function POST() {
  const current = getCurationStatus();
  if (current.status === "running") return NextResponse.json({ ok: true, alreadyRunning: true });
  // Fire-and-forget, like the embedding backfill and Agent runs: the caller
  // polls GET for progress rather than holding a request open for what is one
  // model call per imported block.
  void runImportCuration();
  return NextResponse.json({ ok: true });
}
