import { PageHeader } from "@/components/ui";
import { CouncilsClient } from "./CouncilsClient";

export default function CouncilsPage() {
  return (
    <div>
      <PageHeader
        eyebrow="Collective intelligence"
        title="Magi Council"
        description="Multiple models take on a question together: independent analysis, mutual critique, and a synthesis that still tells you where they disagreed."
      />
      <CouncilsClient />
    </div>
  );
}
