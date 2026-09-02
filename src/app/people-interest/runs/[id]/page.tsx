import { PageHeader } from "@/components/ui";
import { PeopleInterestRunView } from "./PeopleInterestRunView";

export default async function PeopleInterestRunPage({ params }: PageProps<"/people-interest/runs/[id]">) {
  const { id } = await params;
  return (
    <div>
      <PageHeader
        eyebrow="People"
        title="Who might be interested in this?"
        description="Each person you know, weighed against this Project's actual material. A finding is a judgement about relevance, not a suggestion to contact anyone."
      />
      <PeopleInterestRunView runId={id} />
    </div>
  );
}
