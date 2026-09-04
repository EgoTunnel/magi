import { NextRequest, NextResponse } from "next/server";
import { traceTrajectory, trajectoryDigest } from "@/lib/trajectory";
import { getModel, modelForRole, reasoningEffortForRole } from "@/lib/models/registry";
import type { TokenUsage } from "@/lib/models/types";
import { recordUsage } from "@/lib/repo/usage";

// The timeline itself needs no model — it's retrieval reorganized by date, and
// returns instantly. Narration is a separate, opt-in step, so asking "when did
// I first write about X" costs nothing and only "how did my thinking change"
// spends anything.
const NARRATION_SYSTEM_PROMPT =
  "You are describing how someone's own thinking about a topic developed over time, using dated extracts " +
  "from their archive. You are not summarizing the topic — you are characterizing the change.\n\n" +
  "Say what the earliest material shows, what the latest shows, and what actually shifted between them: " +
  "positions abandoned, distinctions that appeared, questions that got answered or turned out to be the " +
  "wrong question. Name dates. Quote sparingly and only from the extracts.\n\n" +
  "Be honest about the shape of the evidence. If the extracts show the topic being restated rather than " +
  "developed, say that the thinking looks stable rather than manufacturing an arc. If there is a gap of " +
  "months, say so rather than smoothing over it. If there is too little here to support any claim about " +
  "change, say that plainly — a real 'this is only two mentions a week apart' is far more useful than an " +
  "invented trajectory.";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const query = (body?.query as string)?.trim();
  if (!query) return NextResponse.json({ error: "query is required" }, { status: 400 });
  const projectId = (body?.projectId as string | undefined) || undefined;
  const narrate = body?.narrate === true;

  const trajectory = await traceTrajectory(query, { projectId });

  if (!narrate || trajectory.totalPassages === 0) {
    return NextResponse.json({ trajectory, narration: null });
  }

  const modelId = modelForRole("synthesizer");
  const resolved = getModel(modelId);
  if (!resolved || !resolved.provider.isConfigured()) {
    return NextResponse.json({
      trajectory,
      narration: null,
      error: "NO_API_KEY",
      message: "No API key configured. Add one in Settings to have Magi describe the change.",
    });
  }

  const usage: TokenUsage[] = [];
  const narration = await resolved.provider.complete({
    model: modelId,
    system: NARRATION_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content:
          `Topic: ${query}\n\n` +
          `${trajectory.totalPassages} matching passages, spanning ${trajectory.spanDays} days ` +
          `(${trajectory.firstDate?.slice(0, 10)} to ${trajectory.lastDate?.slice(0, 10)}).\n\n` +
          `${trajectoryDigest(trajectory)}\n\nDescribe how the thinking developed.`,
      },
    ],
    maxTokens: 1800,
    usage,
    reasoningEffort: reasoningEffortForRole("synthesizer"),
  });
  recordUsage({
    source: "archive_ask",
    provider: resolved.provider.id as "anthropic" | "openrouter" | "chutes",
    model: modelId,
    role: "synthesizer",
    usage,
  });

  return NextResponse.json({ trajectory, narration });
}
