import { PageHeader } from "@/components/ui";
import { MemoryClient } from "./MemoryClient";

export default function MemoryPage() {
  return (
    <div>
      <PageHeader
        eyebrow="Kept on purpose"
        title="Memory"
        description="Saying something once doesn't make it permanent. This page shows exactly what Magi has been told to remember."
      />
      <MemoryClient />
    </div>
  );
}
