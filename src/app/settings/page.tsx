import { PageHeader } from "@/components/ui";
import { SettingsClient } from "./SettingsClient";

export default function SettingsPage() {
  return (
    <div>
      <PageHeader
        eyebrow="Configuration"
        title="Settings"
        description="Configure providers, model roles, and how much Magi is allowed to spend."
      />
      <SettingsClient />
    </div>
  );
}
