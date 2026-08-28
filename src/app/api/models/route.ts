import { NextRequest, NextResponse } from "next/server";
import { listAllModels, getRoleAssignments, setRoleAssignment } from "@/lib/models/registry";
import { MODEL_ROLES } from "@/lib/models/types";
import type { ModelRoleId } from "@/lib/models/types";

export async function GET() {
  return NextResponse.json({
    models: listAllModels(),
    roles: MODEL_ROLES,
    assignments: getRoleAssignments(),
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const role = body.role as ModelRoleId;
  const modelId = body.modelId as string;
  if (!role || !modelId) {
    return NextResponse.json({ error: "role and modelId required" }, { status: 400 });
  }
  setRoleAssignment(role, modelId);
  return NextResponse.json({ ok: true });
}
