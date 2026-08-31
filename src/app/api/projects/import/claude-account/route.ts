import { NextRequest, NextResponse } from "next/server";
import { unzipSync } from "fflate";
import { importClaudeAccountExport } from "@/lib/importers/claudeAccountExport";

// Reads every .json entry under `prefix` inside a zip buffer and parses it.
// Used for both shapes the real export ships: a single conversations.json
// at the zip root (prefix "") and one file per Claude Project under
// projects/<uuid>.json or memories/<uuid>.json (prefix "projects/" etc).
function readJsonEntries(buf: Uint8Array, prefix: string): unknown[] {
  const files = unzipSync(buf);
  const out: unknown[] = [];
  const decoder = new TextDecoder();
  for (const [name, data] of Object.entries(files)) {
    if (!name.startsWith(prefix) || !name.endsWith(".json")) continue;
    try {
      out.push(JSON.parse(decoder.decode(data)));
    } catch {
      // one unparsable entry shouldn't sink the whole import
    }
  }
  return out;
}

export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected a multipart form upload." }, { status: 400 });
  }

  const conversationsFile = form.get("conversations");
  if (!(conversationsFile instanceof File)) {
    return NextResponse.json({ error: "The conversations export .zip (conversations-000.zip) is required." }, { status: 400 });
  }
  const conversationsBuf = new Uint8Array(await conversationsFile.arrayBuffer());
  const conversationsEntries = readJsonEntries(conversationsBuf, "");
  const conversations = conversationsEntries.find((e) => Array.isArray(e)) ?? [];

  let projects: unknown[] = [];
  const projectsFile = form.get("projects");
  if (projectsFile instanceof File) {
    const buf = new Uint8Array(await projectsFile.arrayBuffer());
    projects = readJsonEntries(buf, "projects/");
  }

  let memory: unknown = null;
  const memoriesFile = form.get("memories");
  if (memoriesFile instanceof File) {
    const buf = new Uint8Array(await memoriesFile.arrayBuffer());
    const entries = readJsonEntries(buf, "memories/");
    memory = entries[0] ?? null;
  }

  try {
    const summary = importClaudeAccountExport({ conversations, projects, memory });
    return NextResponse.json({ summary }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Import failed." }, { status: 500 });
  }
}
