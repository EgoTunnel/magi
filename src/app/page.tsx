import Link from "next/link";
import { listProjects, projectCounts } from "@/lib/repo/projects";
import { isAnyProviderConfigured } from "@/lib/models/registry";
import { Button, EmptyState, Panel, Tag } from "@/components/ui";
import { IconArchive, IconCouncil, IconMemory, IconPlus, IconSkills } from "@/components/icons";

export default function HomePage() {
  const projects = listProjects();
  const configured = isAnyProviderConfigured();

  return (
    <div className="mx-auto max-w-4xl px-8 py-10">
      <div className="mb-1 text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--color-text-faint)] font-technical">
        A personal instrument for thinking
      </div>
      <h1 className="text-[26px] font-semibold tracking-[-0.01em] text-[var(--color-text)]">
        Welcome back.
      </h1>
      <p className="mt-2 max-w-xl text-[14px] leading-relaxed text-[var(--color-text-muted)]">
        Magi is the durable layer above the model layer — the environment where your Projects, memory,
        and archive persist regardless of which intelligence you happen to be using today.
      </p>

      {!configured && (
        <div className="mt-6 flex items-center justify-between gap-4 rounded-[4px] border border-[var(--color-accent)] bg-[var(--color-surface)] px-4 py-3">
          <div className="text-[13px] text-[var(--color-text)]">
            No model provider is configured yet. Magi needs an API key before it can think.
          </div>
          <Link href="/settings">
            <Button variant="accent">Open Settings</Button>
          </Link>
        </div>
      )}

      <div className="mt-9 flex items-center justify-between">
        <h2 className="text-[13px] font-semibold uppercase tracking-[0.1em] text-[var(--color-text-faint)] font-technical">
          Projects
        </h2>
        <Link href="/projects">
          <Button variant="ghost">
            <IconPlus /> New Project
          </Button>
        </Link>
      </div>

      {projects.length === 0 ? (
        <div className="mt-4">
          <EmptyState
            title="No Projects yet"
            description="A Project is a place, not a folder — it holds instructions, conversations, memory, documents, and everything that accumulates around one area of your work."
            action={
              <Link href="/projects">
                <Button variant="accent">Create your first Project</Button>
              </Link>
            }
          />
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {projects.map((p) => {
            const counts = projectCounts(p.id);
            return (
              <Link key={p.id} href={`/projects/${p.id}`}>
                <Panel className="h-full px-4 py-3.5 transition-colors hover:border-[var(--color-border-strong)]">
                  <div className="text-[14.5px] font-medium text-[var(--color-text)]">{p.name}</div>
                  {p.tagline && (
                    <div className="mt-0.5 text-[12.5px] text-[var(--color-text-muted)]">{p.tagline}</div>
                  )}
                  <div className="mt-3 flex gap-1.5">
                    <Tag>{counts.conversations} conversations</Tag>
                    <Tag>{counts.memory} memory</Tag>
                  </div>
                </Panel>
              </Link>
            );
          })}
        </div>
      )}

      <div className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <QuickLink href="/archive" icon={<IconArchive />} label="Archive" />
        <QuickLink href="/memory" icon={<IconMemory />} label="Memory" />
        <QuickLink href="/councils" icon={<IconCouncil />} label="Councils" />
        <QuickLink href="/skills" icon={<IconSkills />} label="Skills" />
      </div>
    </div>
  );
}

function QuickLink({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
  return (
    <Link
      href={href}
      className="focus-ring flex flex-col items-start gap-2 rounded-[4px] border border-[var(--color-border)] px-3.5 py-3 text-[var(--color-text-muted)] transition-colors hover:border-[var(--color-border-strong)] hover:text-[var(--color-text)]"
    >
      {icon}
      <span className="text-[13px]">{label}</span>
    </Link>
  );
}
