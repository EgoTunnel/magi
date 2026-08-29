import { PageHeader } from "@/components/ui";
import { ImageLabClient } from "./ImageLabClient";

export default function ImageLabPage() {
  return (
    <div>
      <PageHeader
        eyebrow="Creative atelier"
        title="Image Lab"
        description="Not a prompt playground — a place where a visual language, a cast of characters, and a body of generated work accumulate together."
      />
      <ImageLabClient />
    </div>
  );
}
