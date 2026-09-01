import { PageHeader } from "@/components/ui";
import { SkillsClient } from "./SkillsClient";

export default function SkillsPage() {
  return (
    <div>
      <PageHeader
        eyebrow="Reusable methods"
        title="Skills"
        description="A Skill bundles instructions, tools, and a model into one reusable method. Call it from any conversation it's available in."
      />
      <SkillsClient />
    </div>
  );
}
