import { NextRequest, NextResponse } from "next/server";
import { importProject, type ExportBundle } from "@/lib/portability";
import { detectForeignFormat } from "@/lib/importers/detect";
import { fromChatGPTExport } from "@/lib/importers/chatgpt";
import { fromClaudeExport } from "@/lib/importers/claude";

export async function POST(req: NextRequest) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "That file isn't valid JSON." }, { status: 400 });
  }

  let bundle: ExportBundle;
  const asMagiBundle = raw as ExportBundle;
  if (raw && typeof raw === "object" && !Array.isArray(raw) && asMagiBundle.magiExportVersion === 1 && asMagiBundle.project?.name) {
    bundle = asMagiBundle;
  } else {
    const format = detectForeignFormat(raw);
    if (format === "chatgpt") {
      bundle = fromChatGPTExport(raw);
    } else if (format === "claude") {
      bundle = fromClaudeExport(raw);
    } else {
      return NextResponse.json(
        {
          error:
            "That doesn't look like a Magi Project export, a ChatGPT conversations.json, or a Claude conversations.json.",
        },
        { status: 400 }
      );
    }
  }

  const result = importProject(bundle);
  return NextResponse.json({ project: result }, { status: 201 });
}
