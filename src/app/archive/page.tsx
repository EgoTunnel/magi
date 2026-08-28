import { PageHeader } from "@/components/ui";
import { ArchiveClient } from "./ArchiveClient";

export default function ArchivePage() {
  return (
    <div>
      <PageHeader
        eyebrow="What has happened"
        title="Archive"
        description="Not everything needs to become memory. The archive keeps the record; search it by wording, or ask it a question directly."
      />
      <ArchiveClient />
    </div>
  );
}
