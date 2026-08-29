import { NextRequest, NextResponse } from "next/server";
import { search } from "@/lib/searchIndex";
import { getModel, modelForRole } from "@/lib/models/registry";
import { ROLE_REASONING_EFFORT } from "@/lib/models/types";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const question = (body.question as string)?.trim();
  if (!question) return NextResponse.json({ error: "question is required" }, { status: 400 });

  const results = search(question, { limit: 14 });
  if (results.length === 0) {
    return NextResponse.json({
      answer: "Nothing in the archive touches on this yet.",
      sources: [],
    });
  }

  const modelId = modelForRole("researcher");
  const resolved = getModel(modelId);
  if (!resolved || !resolved.provider.isConfigured()) {
    return NextResponse.json(
      { error: "NO_API_KEY", message: "No API key configured. Add one in Settings." },
      { status: 412 }
    );
  }

  const material = results
    .map((r, i) => `[${i + 1}] (${r.kind}) ${r.title}\n${r.snippet.replace(/⟦|⟧/g, "")}`)
    .join("\n\n");

  const answer = await resolved.provider.complete({
    model: modelId,
    system:
      "You are answering questions about the user's own archive of past Magi conversations, Projects, memory, and documents. Use only the numbered material given to you. Cite sources inline like [1], [2]. If the material doesn't actually answer the question, say so plainly rather than guessing.",
    messages: [{ role: "user", content: `Question: ${question}\n\nArchive material:\n\n${material}` }],
    maxTokens: 1400,
    reasoningEffort: ROLE_REASONING_EFFORT.researcher,
  });

  return NextResponse.json({ answer, sources: results });
}
