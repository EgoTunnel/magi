import { NextResponse } from "next/server";
import { refreshOpenRouterModels } from "@/lib/models/openrouter";

export async function POST() {
  try {
    const models = await refreshOpenRouterModels();
    return NextResponse.json({ ok: true, count: models.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to refresh models";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
