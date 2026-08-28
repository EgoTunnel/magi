import { PageHeader } from "@/components/ui";
import { SettingsClient } from "./SettingsClient";

export default function SettingsPage() {
  return (
    <div>
      <PageHeader
        eyebrow="Configuration"
        title="Settings"
        description="Where the instrument gets tuned: providers, model roles, and how Magi is allowed to spend."
      />
      <SettingsClient />
    </div>
  );
}
