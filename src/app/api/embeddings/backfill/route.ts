import { NextResponse } from "next/server";
import { runEmbeddingBackfill, getBackfillStatus } from "@/lib/embeddingBackfill";

export async function GET() {
  return NextResponse.json({ status: getBackfillStatus() });
}

export async function POST() {
  // Fire-and-forget, same reasoning as Agents/Connections: Magi runs as a
  // long-lived local server, so the job keeps going after this responds. The
  // client polls GET for progress.
  runEmbeddingBackfill().catch(() => {});
  return NextResponse.json({ ok: true });
}
