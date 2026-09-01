import { notFound } from "next/navigation";
import { getCouncilRun } from "@/lib/repo/councils";
import { PageHeader } from "@/components/ui";
import { CouncilRunView } from "./CouncilRunView";

export default async function CouncilRunPage({ params }: PageProps<"/councils/runs/[id]">) {
  const { id } = await params;
  const run = getCouncilRun(id);
  if (!run) notFound();

  return (
    <div>
      <PageHeader eyebrow="Magi Council · Deliberation" title={run.question} />
      <CouncilRunView runId={id} />
    </div>
  );
}
