import fs from "node:fs";
import { NextRequest, NextResponse } from "next/server";
import { getArtifact } from "@/lib/repo/artifacts";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const artifact = getArtifact(id);
  if (!artifact || !artifact.file_path || !fs.existsSync(artifact.file_path)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const bytes = fs.readFileSync(artifact.file_path);
  const ext = artifact.file_path.slice(artifact.file_path.lastIndexOf("."));
  const filename = `${artifact.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "document"}${ext}`;
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": artifact.mime_type ?? "application/octet-stream",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
