import { NextRequest, NextResponse } from "next/server";
import { createMemory, listMemory } from "@/lib/repo/memory";
import { resolveSourceLinks } from "@/lib/sourceLinks";
import { listPeople } from "@/lib/repo/people";

export async function GET(req: NextRequest) {
  const scope = req.nextUrl.searchParams.get("scope") as "global" | "project" | null;
  const projectId = req.nextUrl.searchParams.get("projectId") ?? undefined;
  const memory = listMemory({ scope: scope ?? undefined, projectId });

  // Claim-level provenance for the Memory page: a link back to the exact
  // message a fact was promoted from, or to the conversation an episode
  // closing proposed it from. Resolved here because turning a message id into
  // a URL needs the conversation and Project it belongs to.
  const messageLinks = resolveSourceLinks(
    memory.filter((m) => m.source_message_id).map((m) => ({ kind: "message" as const, refId: m.source_message_id! }))
  );
  const conversationLinks = resolveSourceLinks(
    memory
      .filter((m) => !m.source_message_id && m.source_conversation_id)
      .map((m) => ({ kind: "conversation" as const, refId: m.source_conversation_id! }))
  );

  // A fact about a person lives on that person's page, but the Memory page is
  // the one place that shows everything Magi has been told to remember — so
  // person facts appear here too, named, rather than being quietly invisible.
  const personNames = new Map(listPeople().map((p) => [p.id, p.name]));

  return NextResponse.json({
    memory: memory.map((m) => ({
      ...m,
      personName: m.person_id ? personNames.get(m.person_id) ?? null : null,
      sourceLink:
        (m.source_message_id ? messageLinks.get(`message:${m.source_message_id}`) : null) ??
        (m.source_conversation_id ? conversationLinks.get(`conversation:${m.source_conversation_id}`) : null) ??
        null,
    })),
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  if (!body.content) return NextResponse.json({ error: "content is required" }, { status: 400 });
  const item = createMemory({
    scope: body.scope ?? "global",
    projectId: body.projectId,
    content: body.content,
    source: body.source,
    status: body.status,
    sourceMessageId: body.sourceMessageId,
    sourceConversationId: body.sourceConversationId,
  });
  return NextResponse.json({ item }, { status: 201 });
}
