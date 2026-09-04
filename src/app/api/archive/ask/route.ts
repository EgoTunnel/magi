import { NextRequest, NextResponse } from "next/server";
import { search } from "@/lib/searchIndex";
import { ensureChunkIndex, retrieveChunks } from "@/lib/retrieval";
import { getModel, modelForRole, reasoningEffortForRole } from "@/lib/models/registry";
import type { TokenUsage } from "@/lib/models/types";
import { recordUsage } from "@/lib/repo/usage";

// Enough passages to actually answer a question about the archive rather than
// to gesture at one. Twelve ~1200-character extracts is ~15k characters of
// real material, where the previous keyword path gave the researcher fourteen
// 24-token windows and asked for a synthesis.
const PASSAGE_LIMIT = 12;

export async function POST(req: NextRequest) {
  const body = await req.json();
  const question = (body.question as string)?.trim();
  if (!question) return NextResponse.json({ error: "question is required" }, { status: 400 });

  ensureChunkIndex();
  const passages = await retrieveChunks(question, { limit: PASSAGE_LIMIT }).catch(() => []);

  // Whole-item keyword search still backs this up: rows too short to produce a
  // passage (conversation titles, one-line memory items) only live there.
  const results = passages.length
    ? passages.map((p) => ({
        kind: p.kind,
        refId: p.refId,
        projectId: p.projectId,
        title: p.title,
        snippet: p.content,
        createdAt: p.sourceDate,
        similarity: p.similarity,
      }))
    : search(question, { limit: 14 });

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
    .map((r, i) => `[${i + 1}] (${r.kind}, ${r.createdAt.slice(0, 10)}) ${r.title}\n${r.snippet.replace(/⟦|⟧/g, "")}`)
    .join("\n\n");

  const usage: TokenUsage[] = [];
  const answer = await resolved.provider.complete({
    model: modelId,
    system:
      "You are answering questions about the user's own archive of past Magi conversations, Projects, memory, and documents. Use only the numbered material given to you — these are real passages from it, each labelled with its kind and its date. Cite sources inline like [1], [2]. When the question is about how something changed or when it started, use the dates and say what they support. If the material doesn't actually answer the question, say so plainly rather than guessing.",
    messages: [{ role: "user", content: `Question: ${question}\n\nArchive material:\n\n${material}` }],
    maxTokens: 1400,
    usage,
    reasoningEffort: reasoningEffortForRole("researcher"),
  });
  recordUsage({
    source: "archive_ask",
    provider: resolved.provider.id as "anthropic" | "openrouter" | "chutes",
    model: modelId,
    role: "researcher",
    usage,
  });

  return NextResponse.json({ answer, sources: results });
}
