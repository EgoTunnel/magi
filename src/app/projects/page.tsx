import { PageHeader } from "@/components/ui";
import { ProjectsClient } from "./ProjectsClient";

export default function ProjectsPage() {
  return (
    <div>
      <PageHeader
        eyebrow="Workspace"
        title="Projects"
        description="A Project keeps one piece of your work together. Purpose, instructions, conversations, memory, documents — it all accumulates here over time."
      />
      <ProjectsClient />
    </div>
  );
}
