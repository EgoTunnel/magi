import { NextRequest, NextResponse } from "next/server";
import { getConversation } from "@/lib/repo/conversations";
import { createPendingAttachment } from "@/lib/repo/attachments";

const MAX_BYTES = 15 * 1024 * 1024;

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const conversation = getConversation(id);
  if (!conversation) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });

  const body = await req.json();
  const { filename, mimeType, dataBase64 } = body ?? {};
  if (!filename || !dataBase64) {
    return NextResponse.json({ error: "filename and dataBase64 are required" }, { status: 400 });
  }

  let buffer: Buffer;
  try {
    buffer = Buffer.from(dataBase64, "base64");
  } catch {
    return NextResponse.json({ error: "dataBase64 is not valid base64." }, { status: 400 });
  }
  if (buffer.length > MAX_BYTES) {
    return NextResponse.json({ error: "File is too large — the limit is 15 MB." }, { status: 400 });
  }

  try {
    const attachment = await createPendingAttachment({
      conversationId: id,
      filename,
      mimeType: mimeType || "application/octet-stream",
      buffer,
    });
    return NextResponse.json(
      { attachment: { id: attachment.id, filename: attachment.filename, kind: attachment.kind } },
      { status: 201 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not read that file.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
