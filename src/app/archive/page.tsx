import { PageHeader } from "@/components/ui";
import { ArchiveClient } from "./ArchiveClient";

export default function ArchivePage() {
  return (
    <div>
      <PageHeader
        eyebrow="What has happened"
        title="Archive"
        description="The archive keeps a record of everything, whether or not it's worth remembering as a fact. Search it by wording, or just ask it a question."
      />
      <ArchiveClient />
    </div>
  );
}
