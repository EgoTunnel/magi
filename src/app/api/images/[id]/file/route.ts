import fs from "node:fs";
import { NextRequest, NextResponse } from "next/server";
import { getImage } from "@/lib/repo/images";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const image = getImage(id);
  if (!image || !fs.existsSync(image.file_path)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const bytes = fs.readFileSync(image.file_path);
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": image.mime_type,
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
