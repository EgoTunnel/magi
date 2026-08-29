import { PageHeader } from "@/components/ui";
import { ConnectionRunView } from "./ConnectionRunView";

export default async function ConnectionRunPage({ params }: PageProps<"/connections/runs/[id]">) {
  const { id } = await params;
  return (
    <div>
      <PageHeader
        eyebrow="Cross-Project intelligence"
        title="Connections"
        description="The Projects stay separate. What might genuinely be relevant between them becomes discoverable, on request."
      />
      <ConnectionRunView runId={id} />
    </div>
  );
}
