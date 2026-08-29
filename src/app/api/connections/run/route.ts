import { NextRequest, NextResponse } from "next/server";
import { createConnectionRun } from "@/lib/repo/connections";
import { runConnectionDiscovery } from "@/lib/connections";
import { getModel, modelForRole } from "@/lib/models/registry";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const sourceProjectId = body.sourceProjectId as string | undefined;
  const targetProjectId = (body.targetProjectId as string | undefined) || null;
  if (!sourceProjectId) {
    return NextResponse.json({ error: "sourceProjectId is required" }, { status: 400 });
  }

  const resolved = getModel(modelForRole("researcher"));
  if (!resolved || !resolved.provider.isConfigured()) {
    return NextResponse.json(
      { error: "NO_API_KEY", message: "No API key configured. Add one in Settings before finding connections." },
      { status: 412 }
    );
  }

  const run = createConnectionRun({ sourceProjectId, targetProjectId });

  // Fire-and-forget, same as Agents: Magi runs as a long-lived local server,
  // so this keeps working after the response below is sent.
  runConnectionDiscovery({ runId: run.id, sourceProjectId, targetProjectId }).catch(() => {});

  return NextResponse.json({ run }, { status: 201 });
}
