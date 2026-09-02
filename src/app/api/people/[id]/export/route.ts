import { NextRequest, NextResponse } from "next/server";
import { exportPerson } from "@/lib/repo/people";

// "What does your app know about me?" — with a file as the answer. This is the
// first Magi feature whose subject is other people, so everything held about
// one of them has to be producible in a single, readable document.
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const bundle = exportPerson(id);
  if (!bundle) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const filename = `${bundle.person.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "person"}-magi-export.json`;
  return new NextResponse(JSON.stringify(bundle, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
