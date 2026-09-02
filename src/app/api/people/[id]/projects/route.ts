import { NextRequest, NextResponse } from "next/server";
import {
  associate,
  dissociate,
  getPerson,
  listProjectsForPerson,
  setAssociationStatus,
} from "@/lib/repo/people";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return NextResponse.json({ projects: listProjectsForPerson(id) });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!getPerson(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await req.json();
  if (!body.projectId) return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  associate(String(body.projectId), id, body.role ?? null);
  return NextResponse.json({ projects: listProjectsForPerson(id) }, { status: 201 });
}

// Keeping a proposed association is what actually puts someone on the roster
// the model sees in every turn of that Project — so it is its own deliberate
// act, separate from the person existing at all.
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json();
  if (!body.projectId) return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  if (body.status !== "established" && body.status !== "suggested") {
    return NextResponse.json({ error: "status must be established or suggested" }, { status: 400 });
  }
  setAssociationStatus(String(body.projectId), id, body.status);
  return NextResponse.json({ projects: listProjectsForPerson(id) });
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const projectId = req.nextUrl.searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  dissociate(projectId, id);
  return NextResponse.json({ projects: listProjectsForPerson(id) });
}
