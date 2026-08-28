import { NextRequest, NextResponse } from "next/server";
import { getSetting, setSetting, deleteSetting } from "@/lib/settings";
import { isAnyProviderConfigured } from "@/lib/models/registry";

export async function GET() {
  const key = getSetting("anthropic_api_key");
  return NextResponse.json({
    anthropicKeySet: !!key || !!process.env.ANTHROPIC_API_KEY,
    anthropicKeyPreview: key ? `${"•".repeat(Math.max(key.length - 4, 0))}${key.slice(-4)}` : null,
    configured: isAnyProviderConfigured(),
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  if (typeof body.anthropicApiKey === "string") {
    if (body.anthropicApiKey.trim()) {
      setSetting("anthropic_api_key", body.anthropicApiKey.trim());
    } else {
      deleteSetting("anthropic_api_key");
    }
  }
  return NextResponse.json({ ok: true });
}
