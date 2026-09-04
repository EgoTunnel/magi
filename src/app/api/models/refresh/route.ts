import { NextRequest, NextResponse } from "next/server";
import { refreshOpenRouterModels } from "@/lib/models/openrouter";
import { refreshChutesModels } from "@/lib/models/chutes";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const provider = body.provider === "chutes" ? "chutes" : "openrouter";
  try {
    const models = provider === "chutes" ? await refreshChutesModels() : await refreshOpenRouterModels();
    return NextResponse.json({ ok: true, count: models.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to refresh models";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
