import { NextRequest, NextResponse } from "next/server";
import { draftCouncilDecision, recordCouncilDecision } from "@/lib/councilDecisions";

// Recording a Council's conclusion in its Project:
//   { action: "draft" }                               → a decision (and open question) to edit
//   { action: "record", decision, openQuestion? }     → keep them as the Project's own
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  try {
    if (body.action === "draft") return NextResponse.json(await draftCouncilDecision(id));
    if (body.action === "record") {
      const notes = recordCouncilDecision(id, {
        decision: typeof body.decision === "string" ? body.decision : "",
        openQuestion: typeof body.openQuestion === "string" ? body.openQuestion : null,
      });
      return NextResponse.json({ notes }, { status: 201 });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "That didn't work." }, { status: 400 });
  }
}
