import { PageHeader } from "@/components/ui";
import { PeopleClient } from "./PeopleClient";

export default function PeoplePage() {
  return (
    <div>
      <PageHeader
        eyebrow="Who this work involves"
        title="People"
        description="The people connected to your work — what you know about each of them, and where you learned it. Not a contact book: no numbers, no addresses, nothing that syncs."
      />
      <PeopleClient />
    </div>
  );
}
