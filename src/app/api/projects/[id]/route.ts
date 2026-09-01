import { NextRequest, NextResponse } from "next/server";
import { deleteProject, getProject, projectCounts, updateProject } from "@/lib/repo/projects";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const project = getProject(id);
  if (!project) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ project, counts: projectCounts(id) });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json();
  let project;
  try {
    project = updateProject(id, body);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "invalid update" }, { status: 400 });
  }
  if (!project) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ project });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  deleteProject(id);
  return NextResponse.json({ ok: true });
}
