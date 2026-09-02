import Link from "next/link";
import { listProjects } from "@/lib/repo/projects";
import { listRecentConversations } from "@/lib/repo/conversations";
import {
  IconArchive,
  IconCouncil,
  IconHome,
  IconImageLab,
  IconMemory,
  IconPeople,
  IconProjects,
  IconSettings,
  IconSkills,
} from "@/components/icons";
import { MagiMark } from "@/components/MagiMark";
import { ThemeToggle } from "@/components/shell/ThemeToggle";
import { SidebarSection } from "@/components/shell/SidebarSection";

const NAV = [
  { href: "/", label: "Home", icon: IconHome },
  { href: "/projects", label: "Projects", icon: IconProjects },
  { href: "/archive", label: "Archive", icon: IconArchive },
  { href: "/memory", label: "Memory", icon: IconMemory },
  { href: "/people", label: "People", icon: IconPeople },
  { href: "/image-lab", label: "Image Lab", icon: IconImageLab },
  { href: "/councils", label: "Councils", icon: IconCouncil },
  { href: "/skills", label: "Skills", icon: IconSkills },
];

export function Sidebar() {
  const projects = listProjects().slice(0, 8);
  const conversations = listRecentConversations(5);

  return (
    <aside className="flex h-full w-60 shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-bg-raised)]">
      <Link href="/" className="focus-ring flex items-center gap-2.5 px-4 py-4">
        <MagiMark width={19} height={19} className="text-[var(--color-accent)]" />
        <span className="text-[13px] font-semibold tracking-[0.18em] uppercase text-[var(--color-text)]">
          Magi
        </span>
      </Link>

      <nav className="flex flex-col gap-0.5 px-2">
        {NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="focus-ring group flex items-center gap-2.5 rounded-[3px] px-2.5 py-1.5 text-[13px] text-[var(--color-text-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-text)] transition-colors"
          >
            <item.icon className="text-[var(--color-text-faint)] group-hover:text-[var(--color-accent)] transition-colors" />
            {item.label}
          </Link>
        ))}
      </nav>

      <div className="mt-5 flex-1 overflow-y-auto px-2">
        <SidebarSection title="Recent Projects">
          {projects.length === 0 && (
            <div className="px-2.5 py-1.5 text-[12.5px] text-[var(--color-text-faint)]">
              No projects yet
            </div>
          )}
          {projects.map((p) => (
            <Link
              key={p.id}
              href={`/projects/${p.id}`}
              className="focus-ring truncate rounded-[3px] px-2.5 py-1.5 text-[12.5px] text-[var(--color-text-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-text)] transition-colors"
              title={p.name}
            >
              {p.name}
            </Link>
          ))}
        </SidebarSection>

        <SidebarSection title="Recent Conversations">
          {conversations.length === 0 && (
            <div className="px-2.5 py-1.5 text-[12.5px] text-[var(--color-text-faint)]">
              No conversations yet
            </div>
          )}
          {conversations.map((c) => (
            <Link
              key={c.id}
              href={`/projects/${c.project_id}/c/${c.id}`}
              className="focus-ring group flex flex-col rounded-[3px] px-2.5 py-1.5 hover:bg-[var(--color-surface)] transition-colors"
              title={c.title}
            >
              <span className="truncate text-[12.5px] text-[var(--color-text-muted)] group-hover:text-[var(--color-text)]">
                {c.title}
              </span>
              <span className="truncate text-[10.5px] text-[var(--color-text-faint)]">{c.project_name}</span>
            </Link>
          ))}
        </SidebarSection>
      </div>

      <div className="flex items-center justify-between border-t border-[var(--color-border)] px-3 py-3">
        <Link
          href="/settings"
          className="focus-ring flex items-center gap-2 rounded-[3px] px-2 py-1.5 text-[12.5px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
        >
          <IconSettings />
          Settings
        </Link>
        <ThemeToggle />
      </div>
    </aside>
  );
}
