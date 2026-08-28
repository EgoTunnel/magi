import { PageHeader } from "@/components/ui";
import { CouncilsClient } from "./CouncilsClient";

export default function CouncilsPage() {
  return (
    <div>
      <PageHeader
        eyebrow="Collective intelligence"
        title="Magi Council"
        description="Several intelligences operating within a shared environment — independent analysis, mutual critique, and a synthesis that does not paper over real disagreement."
      />
      <CouncilsClient />
    </div>
  );
}
