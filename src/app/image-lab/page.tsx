import { PageHeader } from "@/components/ui";
import { ImageLabClient } from "./ImageLabClient";

export default function ImageLabPage() {
  return (
    <div>
      <PageHeader
        eyebrow="Creative atelier"
        title="Image Lab"
        description="A visual style, a cast of characters, and everything you've generated build up here over time, so a new image can actually look like it belongs with the rest."
      />
      <ImageLabClient />
    </div>
  );
}
