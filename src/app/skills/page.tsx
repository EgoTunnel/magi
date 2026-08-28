import { PageHeader } from "@/components/ui";
import { SkillsClient } from "./SkillsClient";

export default function SkillsPage() {
  return (
    <div>
      <PageHeader
        eyebrow="Reusable methods"
        title="Skills"
        description="A tool says “search the web.” A Skill says “conduct a rigorous research investigation.” Invoke one from any conversation in its scope."
      />
      <SkillsClient />
    </div>
  );
}
