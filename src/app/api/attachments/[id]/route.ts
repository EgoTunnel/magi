import { NextResponse } from "next/server";
import { deleteAttachment } from "@/lib/repo/attachments";

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  deleteAttachment(id);
  return NextResponse.json({ ok: true });
}
