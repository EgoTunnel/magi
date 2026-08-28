import { NextRequest, NextResponse } from "next/server";
import { createAgentRun } from "@/lib/repo/agents";
import { runAgent } from "@/lib/agent";
import { getModel, modelForRole } from "@/lib/models/registry";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const objective = (body.objective as string)?.trim();
  const projectId = (body.projectId as string | undefined) ?? null;
  if (!objective) return NextResponse.json({ error: "objective is required" }, { status: 400 });

  const resolved = getModel(modelForRole("reasoner"));
  if (!resolved || !resolved.provider.isConfigured()) {
    return NextResponse.json(
      { error: "NO_API_KEY", message: "No API key configured. Add one in Settings before running an Agent." },
      { status: 412 }
    );
  }

  const run = createAgentRun({ objective, projectId });

  // Fire-and-forget: Magi runs as a long-lived local server, not a serverless
  // function, so this keeps running after the response below is sent. The
  // client polls the run instead of holding the request open.
  runAgent({ runId: run.id, objective, projectId }).catch(() => {});

  return NextResponse.json({ run }, { status: 201 });
}
