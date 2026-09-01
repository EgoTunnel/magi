import { PageHeader } from "@/components/ui";
import { AgentRunView } from "./AgentRunView";

export default async function AgentRunPage({ params }: PageProps<"/agents/runs/[id]">) {
  const { id } = await params;
  return (
    <div>
      <PageHeader eyebrow="Agent" title="Pursuing an objective" description="Plan, research, draft, critique, revise. You can watch each step happen and stop it whenever you want." />
      <AgentRunView runId={id} />
    </div>
  );
}
