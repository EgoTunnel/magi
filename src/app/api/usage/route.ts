import { NextRequest, NextResponse } from "next/server";
import { totalSpend, spendByModel } from "@/lib/repo/usage";
import { getAnthropicPricing, setAnthropicPricing, type AnthropicModelPrice } from "@/lib/models/pricing";

function startOfTodayIso(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export async function GET() {
  return NextResponse.json({
    allTime: totalSpend(),
    today: totalSpend({ sinceIso: startOfTodayIso() }),
    byModel: spendByModel(),
    anthropicPricing: getAnthropicPricing(),
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  if (body.anthropicPricing && typeof body.anthropicPricing === "object") {
    setAnthropicPricing(body.anthropicPricing as Record<string, AnthropicModelPrice>);
  }
  return NextResponse.json({ ok: true });
}
