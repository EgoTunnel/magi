import { NextRequest, NextResponse } from "next/server";
import { getPerson, listProjectsForPerson } from "@/lib/repo/people";
import { traceTrajectory } from "@/lib/trajectory";
import { SEARCH_KINDS } from "@/lib/searchIndex";

// "How has my work with X developed?" — free, because passages are already
// dated and the person already has names to match on. No model call: this is
// retrieval reorganized by time, the same as the Archive's Over time mode.
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const person = getPerson(id);
  if (!person) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const query = [person.name, ...person.aliases].join(" ").trim();
  if (!query) return NextResponse.json({ trajectory: null });

  // Rolodex records themselves are excluded. A person's own record is indexed
  // under their name and dated when it was written, so leaving it in puts a
  // false point at "today" on the end of every person's timeline — the record
  // is not an occasion on which they came up. Derived from SEARCH_KINDS rather
  // than listed, so a future kind is included by default.
  const kinds = SEARCH_KINDS.filter((k) => k !== "person");

  // Scoped to their Projects by default, for the same reason mentions are: a
  // first name matches across every Project, and a timeline built from other
  // people's Annas is worse than no timeline.
  const projectIds = listProjectsForPerson(person.id)
    .filter((p) => p.status === "established")
    .map((p) => p.id);
  const scope = req.nextUrl.searchParams.get("scope") === "everywhere" || !projectIds.length ? "everywhere" : "projects";

  return NextResponse.json({
    scope,
    scopedProjectCount: projectIds.length,
    trajectory: await traceTrajectory(query, {
      kinds,
      projectId: scope === "projects" ? projectIds : undefined,
    }),
  });
}
