import { NextRequest, NextResponse } from "next/server";
import { createCouncilRun, getCouncil, type CouncilMode, type CouncilRole, type RunAttachment } from "@/lib/repo/councils";
import { runCouncilDeliberation } from "@/lib/council";
import { extractText, isExtractableFileType } from "@/lib/files/extractText";

// Same cap the other upload routes use (documents/upload, conversations/[id]/attachments).
const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;

async function extractAttachments(
  raw: unknown
): Promise<{ ok: true; attachments: RunAttachment[] } | { ok: false; error: string }> {
  if (!Array.isArray(raw) || raw.length === 0) return { ok: true, attachments: [] };
  const attachments: RunAttachment[] = [];
  for (const item of raw) {
    const { filename, mimeType, dataBase64 } = (item ?? {}) as { filename?: string; mimeType?: string; dataBase64?: string };
    if (!filename || !dataBase64) return { ok: false, error: "Each attachment needs a filename and dataBase64." };
    if (!isExtractableFileType(mimeType || "", filename)) {
      return {
        ok: false,
        error: (mimeType || "").startsWith("image/")
          ? "Images aren't supported as Council attachments yet."
          : `Unsupported file type: ${mimeType || "unknown"} (${filename}).`,
      };
    }
    let buffer: Buffer;
    try {
      buffer = Buffer.from(dataBase64, "base64");
    } catch {
      return { ok: false, error: `"${filename}" is not valid base64.` };
    }
    if (buffer.length > MAX_ATTACHMENT_BYTES) {
      return { ok: false, error: `"${filename}" is too large — the limit is 15 MB.` };
    }
    try {
      const extractedText = await extractText({ buffer, mimeType: mimeType || "", filename });
      attachments.push({ filename, extractedText });
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : `Could not read "${filename}".` };
    }
  }
  return { ok: true, attachments };
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const question = (body.question as string)?.trim();
  if (!question) return NextResponse.json({ error: "question is required" }, { status: 400 });

  let roles: CouncilRole[] | undefined = body.roles;
  if (body.councilId) {
    const council = getCouncil(body.councilId);
    if (!council) return NextResponse.json({ error: "council not found" }, { status: 404 });
    roles = council.roles;
  }
  if (!roles || !roles.length) {
    return NextResponse.json({ error: "roles[] or councilId is required" }, { status: 400 });
  }

  const mode = (body.mode as CouncilMode | undefined) ?? "independent";
  if (mode === "debate" && roles.length !== 2) {
    return NextResponse.json({ error: "Debate mode needs exactly 2 roles." }, { status: 400 });
  }
  if (mode === "redTeam" && roles.length < 2) {
    return NextResponse.json({ error: "Red Team mode needs at least 2 roles." }, { status: 400 });
  }

  const extracted = await extractAttachments(body.attachments);
  if (!extracted.ok) return NextResponse.json({ error: extracted.error }, { status: 400 });

  const run = createCouncilRun({
    councilId: body.councilId,
    projectId: body.projectId,
    question,
    mode,
    attachments: extracted.attachments,
  });

  // Fire-and-forget: Magi runs as a long-lived local server, not a serverless
  // function, so this keeps running after the response below is sent. The
  // client polls the run instead of holding the request open — deliberation
  // across several roles can take a while, and there's no reason to block on
  // it. runCouncilDeliberation catches its own errors and marks the run
  // "error" internally, so nothing here needs to react to a rejection.
  runCouncilDeliberation({
    runId: run.id,
    question,
    roles,
    projectId: body.projectId,
    mode,
    attachments: extracted.attachments,
  }).catch(() => {});

  return NextResponse.json({ run }, { status: 201 });
}
