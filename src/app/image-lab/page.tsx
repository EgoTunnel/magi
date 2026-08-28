import { PageHeader, Panel } from "@/components/ui";
import { IconImageLab } from "@/components/icons";

export default function ImageLabPage() {
  return (
    <div>
      <PageHeader
        eyebrow="Creative atelier"
        title="Image Lab"
        description="Not a prompt playground — a place where a visual language, a cast of characters, and a body of generated work accumulate together."
      />
      <div className="mx-auto max-w-2xl px-8 py-10">
        <Panel className="flex flex-col items-start gap-4 px-6 py-8">
          <IconImageLab width={22} height={22} className="text-[var(--color-accent)]" />
          <div>
            <h2 className="text-[15px] font-medium text-[var(--color-text)]">Not yet built</h2>
            <p className="mt-2 max-w-lg text-[13.5px] leading-relaxed text-[var(--color-text-muted)]">
              The Image Lab is architected for — Image Projects, Style Guides, and Character libraries that
              give generated work the same continuity as everything else in Magi — but it isn&apos;t wired to
              an image model yet. The rest of Magi was built first because a durable environment for text
              and reasoning has to exist before a durable environment for images is worth building on top of
              it.
            </p>
            <p className="mt-3 max-w-lg text-[13.5px] leading-relaxed text-[var(--color-text-muted)]">
              When an image provider is added to the model layer, it will slot in the same way Anthropic
              did: through the provider abstraction, assignable to a role, with its results kept as
              versioned artifacts inside whichever Project they belong to.
            </p>
          </div>
        </Panel>
      </div>
    </div>
  );
}
