import { PageHeader } from "@/components/ui";
import { MemoryClient } from "./MemoryClient";

export default function MemoryPage() {
  return (
    <div>
      <PageHeader
        eyebrow="Deliberate, not automatic"
        title="Memory"
        description="Something said once should not automatically become permanent knowledge. This is what Magi has been told, explicitly, to retain."
      />
      <MemoryClient />
    </div>
  );
}
