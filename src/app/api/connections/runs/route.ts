import { NextRequest, NextResponse } from "next/server";
import { listConnectionRuns } from "@/lib/repo/connections";

export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("projectId") ?? undefined;
  return NextResponse.json({ runs: listConnectionRuns({ projectId }) });
}
