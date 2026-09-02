import { NextRequest, NextResponse } from "next/server";
import { deleteSkill, getSkill, updateSkill, type SkillStage } from "@/lib/repo/skills";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const skill = getSkill(id);
  if (!skill) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ skill });
}

// Stages arrive as free-form JSON from the client; a stage with no name or no
// instructions can't be run, so it's dropped rather than stored to fail later.
function cleanStages(raw: unknown): SkillStage[] | null {
  if (!Array.isArray(raw)) return null;
  const stages = raw
    .filter((s): s is Record<string, unknown> => !!s && typeof s === "object")
    .map((s) => ({
      name: typeof s.name === "string" ? s.name.trim() : "",
      instructions: typeof s.instructions === "string" ? s.instructions.trim() : "",
      modelRole: typeof s.modelRole === "string" && s.modelRole ? s.modelRole : null,
      useTools: s.useTools === true,
    }))
    .filter((s) => s.name && s.instructions);
  return stages.length ? stages : null;
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json();
  const skill = updateSkill(id, {
    name: typeof body.name === "string" ? body.name : undefined,
    description: body.description !== undefined ? body.description : undefined,
    instructions: typeof body.instructions === "string" ? body.instructions : undefined,
    allowedTools: body.allowedTools !== undefined ? body.allowedTools : undefined,
    modelRole: body.modelRole !== undefined ? body.modelRole || null : undefined,
    stages: body.stages !== undefined ? cleanStages(body.stages) : undefined,
  });
  if (!skill) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ skill });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  deleteSkill(id);
  return NextResponse.json({ ok: true });
}
