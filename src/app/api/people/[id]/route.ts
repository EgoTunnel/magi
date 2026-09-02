import { NextRequest, NextResponse } from "next/server";
import {
  deletePerson,
  getPerson,
  listPersonFacts,
  listProjectsForPerson,
  setPersonStatus,
  updatePerson,
} from "@/lib/repo/people";
import { attachClaimLinks } from "@/lib/sourceLinks";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const person = getPerson(id);
  if (!person) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({
    person,
    // Each fact carries a link back to the message or conversation it was
    // learned in — "what you know and where you learned it" is the feature.
    facts: attachClaimLinks(listPersonFacts(id)),
    projects: listProjectsForPerson(id),
  });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json();
  let person = null;
  if (body.status === "established" || body.status === "suggested") person = setPersonStatus(id, body.status);
  if (
    body.name !== undefined ||
    body.aliases !== undefined ||
    body.relationship !== undefined ||
    body.summary !== undefined
  ) {
    person = updatePerson(id, {
      name: body.name,
      aliases: Array.isArray(body.aliases) ? body.aliases.filter((a: unknown) => typeof a === "string") : undefined,
      relationship: body.relationship,
      summary: body.summary,
    });
  }
  if (!person) person = getPerson(id);
  if (!person) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ person });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  // Real deletion: the person, their facts, their associations, and every
  // index / embedding / passage row that made them retrievable.
  deletePerson(id);
  return NextResponse.json({ ok: true });
}
