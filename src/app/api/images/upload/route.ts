import { NextRequest, NextResponse } from "next/server";
import { saveUploadedImage } from "@/lib/repo/images";

const MAX_BYTES = 15 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { projectId, filename, mimeType, dataBase64 } = body ?? {};
  if (!projectId || !filename || !dataBase64) {
    return NextResponse.json({ error: "projectId, filename, and dataBase64 are required" }, { status: 400 });
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
    const image = saveUploadedImage({
      projectId,
      filename,
      mimeType: mimeType || "application/octet-stream",
      buffer,
    });
    return NextResponse.json({ image }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not read that file.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
