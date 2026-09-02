import { NextRequest, NextResponse } from "next/server";
import { createPeopleInterestRun } from "@/lib/repo/peopleInterest";
import { runPeopleInterestDiscovery } from "@/lib/peopleInterest";
import { getModel, modelForRole } from "@/lib/models/registry";
import { listPeople } from "@/lib/repo/people";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const projectId = body.projectId as string | undefined;
  if (!projectId) return NextResponse.json({ error: "projectId is required" }, { status: 400 });

  // Worth failing early and plainly: the answer to this question is only as
  // good as the rolodex behind it, and an empty rolodex produces an expensive
  // run that says nothing.
  if (!listPeople({ status: "established" }).length) {
    return NextResponse.json(
      {
        error: "NO_PEOPLE",
        message: "No people are recorded yet. Add someone on the People page first.",
      },
      { status: 412 }
    );
  }

  const resolved = getModel(modelForRole("researcher"));
  if (!resolved || !resolved.provider.isConfigured()) {
    return NextResponse.json(
      { error: "NO_API_KEY", message: "No API key configured. Add one in Settings first." },
      { status: 412 }
    );
  }

  const run = createPeopleInterestRun(projectId);
  // Fire-and-forget, like Agents and Connections: Magi is a long-lived local
  // server, so this keeps running after the response is sent.
  runPeopleInterestDiscovery({ runId: run.id, projectId }).catch(() => {});
  return NextResponse.json({ run }, { status: 201 });
}
