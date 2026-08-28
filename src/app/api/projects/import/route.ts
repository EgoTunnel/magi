import { NextRequest, NextResponse } from "next/server";
import { importProject, type ExportBundle } from "@/lib/portability";

export async function POST(req: NextRequest) {
  let bundle: ExportBundle;
  try {
    bundle = await req.json();
  } catch {
    return NextResponse.json({ error: "That file isn't valid JSON." }, { status: 400 });
  }
  if (bundle?.magiExportVersion !== 1 || !bundle.project?.name) {
    return NextResponse.json({ error: "That doesn't look like a Magi Project export." }, { status: 400 });
  }
  const result = importProject(bundle);
  return NextResponse.json({ project: result }, { status: 201 });
}
