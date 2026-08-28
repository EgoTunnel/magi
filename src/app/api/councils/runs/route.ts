import { NextRequest, NextResponse } from "next/server";
import { listCouncilRuns } from "@/lib/repo/councils";

export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("projectId") ?? undefined;
  return NextResponse.json({ runs: listCouncilRuns({ projectId }) });
}
