import { NextRequest, NextResponse } from "next/server";
import { createPerson, listPeople, listPeopleForProject, type Person } from "@/lib/repo/people";

export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("projectId");
  const status = req.nextUrl.searchParams.get("status") as Person["status"] | null;
  // For a Project, `status` filters on the *person* — the association's own
  // state travels on each row as association_status, since the two are
  // separate decisions.
  const people = projectId
    ? listPeopleForProject(projectId).filter((p) => !status || p.status === status)
    : listPeople({ status: status ?? undefined });
  return NextResponse.json({ people });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  if (!body.name || !String(body.name).trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  const person = createPerson({
    name: String(body.name),
    aliases: Array.isArray(body.aliases) ? body.aliases.filter((a: unknown) => typeof a === "string") : [],
    relationship: body.relationship ?? null,
    summary: body.summary ?? null,
    // Anything Magi proposes must arrive suggested. Nothing but a deliberate
    // act by the user establishes a person.
    status: body.status === "suggested" ? "suggested" : "established",
    closureId: body.closureId ?? null,
    sourceConversationId: body.sourceConversationId ?? null,
  });
  return NextResponse.json({ person }, { status: 201 });
}
