import { NextRequest, NextResponse } from "next/server";
import { exportProject } from "@/lib/portability";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const bundle = exportProject(id);
    const filename = `${bundle.project.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "project"}-magi-export.json`;
    return new NextResponse(JSON.stringify(bundle, null, 2), {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
}
