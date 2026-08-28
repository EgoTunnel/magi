import { NextRequest, NextResponse } from "next/server";
import { listAgentRuns } from "@/lib/repo/agents";

export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("projectId") ?? undefined;
  return NextResponse.json({ runs: listAgentRuns({ projectId }) });
}
