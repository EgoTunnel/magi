import { NextRequest, NextResponse } from "next/server";
import { getAgentRun, setAgentStatus } from "@/lib/repo/agents";

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const run = getAgentRun(id);
  if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (run.status === "running") setAgentStatus(id, "stopping");
  return NextResponse.json({ run: getAgentRun(id) });
}
