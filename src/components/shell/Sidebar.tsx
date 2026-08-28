import Link from "next/link";
import { listProjects } from "@/lib/repo/projects";
import {
  IconArchive,
  IconCouncil,
  IconHome,
  IconImageLab,
  IconMemory,
  IconProjects,
  IconSettings,
  IconSkills,
} from "@/components/icons";
import { ThemeToggle } from "@/components/shell/ThemeToggle";

const NAV = [
  { href: "/", label: "Home", icon: IconHome },
  { href: "/projects", label: "Projects", icon: IconProjects },
  { href: "/archive", label: "Archive", icon: IconArchive },
  { href: "/memory", label: "Memory", icon: IconMemory },
  { href: "/image-lab", label: "Image Lab", icon: IconImageLab },
  { href: "/councils", label: "Councils", icon: IconCouncil },
  { href: "/skills", label: "Skills", icon: IconSkills },
];

export function Sidebar() {
  const projects = listProjects().slice(0, 8);

  return (
    <aside className="flex h-full w-60 shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-bg-raised)]">
      <div className="flex items-center gap-2 px-4 py-4">
        <div className="flex h-6 w-6 items-center justify-center rounded-[2px] border border-[var(--color-border-strong)] text-[10px] font-semibold tracking-widest text-[var(--color-accent)] font-technical">
          M
        </div>
        <span className="text-[13px] font-semibold tracking-[0.14em] uppercase text-[var(--color-text)]">
          Magi
        </span>
      </div>

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
        <div className="px-2.5 pb-1.5 text-[10.5px] font-medium uppercase tracking-[0.12em] text-[var(--color-text-faint)]">
          Recent Projects
        </div>
        <div className="flex flex-col gap-0.5">
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
        </div>
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
