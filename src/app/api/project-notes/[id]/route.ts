import { NextRequest, NextResponse } from "next/server";
import { deleteProjectNote, setProjectNoteStatus } from "@/lib/repo/projectNotes";

const STATUSES = ["proposed", "open", "settled", "resolved"] as const;

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json();
  if (!STATUSES.includes(body.status)) {
    return NextResponse.json({ error: "status must be one of " + STATUSES.join(", ") }, { status: 400 });
  }
  return NextResponse.json({ note: setProjectNoteStatus(id, body.status) });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  deleteProjectNote(id);
  return NextResponse.json({ ok: true });
}
