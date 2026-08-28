import { Suspense } from "react";
import { PageHeader } from "@/components/ui";
import { ProjectsClient } from "./ProjectsClient";

export default function ProjectsPage() {
  return (
    <div>
      <PageHeader
        eyebrow="Workspace"
        title="Projects"
        description="A Project is a place, not a folder. Purpose, instructions, conversations, memory, and documents accumulate here over time."
      />
      <Suspense>
        <ProjectsClient />
      </Suspense>
    </div>
  );
}
