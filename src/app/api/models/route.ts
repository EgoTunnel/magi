import { NextRequest, NextResponse } from "next/server";
import {
  listAllModels,
  getRoleAssignments,
  setRoleAssignment,
  getReasoningEffortAssignments,
  setReasoningEffortForRole,
} from "@/lib/models/registry";
import { MODEL_ROLES, REASONING_EFFORTS } from "@/lib/models/types";
import type { ModelRoleId, ReasoningEffort } from "@/lib/models/types";

export async function GET() {
  return NextResponse.json({
    models: listAllModels(),
    roles: MODEL_ROLES,
    assignments: getRoleAssignments(),
    reasoningEfforts: REASONING_EFFORTS,
    reasoningEffortAssignments: getReasoningEffortAssignments(),
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const role = body.role as ModelRoleId;
  if (!role) {
    return NextResponse.json({ error: "role required" }, { status: 400 });
  }
  if (typeof body.modelId === "string" && body.modelId) {
    setRoleAssignment(role, body.modelId);
  }
  if (typeof body.reasoningEffort === "string" && body.reasoningEffort) {
    setReasoningEffortForRole(role, body.reasoningEffort as ReasoningEffort);
  }
  return NextResponse.json({ ok: true });
}
