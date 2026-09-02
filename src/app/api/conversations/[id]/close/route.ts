import { NextRequest, NextResponse } from "next/server";
import { draftClosure, getDraft } from "@/lib/episodeClose";
import { getClosureForConversation, markClosureReviewed } from "@/lib/repo/episodes";

// GET returns whatever draft already exists (so reopening a conversation shows
// an unreviewed one rather than silently re-spending on a fresh pass); POST
// drafts, or redrafts, replacing the previous draft's un-kept proposals.
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return NextResponse.json({ draft: getDraft(id) });
}

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    return NextResponse.json({ draft: await draftClosure(id) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not close this episode.";
    if (message === "NO_API_KEY") {
      return NextResponse.json(
        { error: "NO_API_KEY", message: "No API key configured. Add one in Settings." },
        { status: 412 }
      );
    }
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

// Marks the draft as reviewed once the user has been through it. Whatever they
// didn't keep stays behind as 'suggested'/'proposed' rather than being deleted
// for them — those are still visible on the Memory page and the Project
// dashboard, and are theirs to clear.
export async function PATCH(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const closure = getClosureForConversation(id);
  if (!closure) return NextResponse.json({ error: "no draft to review" }, { status: 404 });
  return NextResponse.json({ closure: markClosureReviewed(closure.id) });
}
