import { NextRequest, NextResponse } from "next/server";
import { acceptStandingSignal, dismissStandingSignal } from "@/lib/standingWatch";

// A signal is acted on, not edited: accept it (resolve the question, or open
// a "revisit" question for the decision) or dismiss it. There is no PATCH of
// arbitrary fields because there is nothing else a user should do to one.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const action = body.action;
  if (action !== "accept" && action !== "dismiss") {
    return NextResponse.json({ error: "action must be accept or dismiss" }, { status: 400 });
  }
  const result = action === "accept" ? acceptStandingSignal(id) : dismissStandingSignal(id);
  if (!result) return NextResponse.json({ error: "Signal not found or already handled" }, { status: 404 });
  return NextResponse.json(result);
}
