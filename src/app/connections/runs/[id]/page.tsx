import { PageHeader } from "@/components/ui";
import { ConnectionRunView } from "./ConnectionRunView";

export default async function ConnectionRunPage({ params }: PageProps<"/connections/runs/[id]">) {
  const { id } = await params;
  return (
    <div>
      <PageHeader
        eyebrow="Cross-Project intelligence"
        title="Connections"
        description="Projects stay separate by default. Ask, and Magi will go look for what actually connects them."
      />
      <ConnectionRunView runId={id} />
    </div>
  );
}
