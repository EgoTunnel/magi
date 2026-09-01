"use client";

import { useState, type ReactNode } from "react";
import { IconChevronDown, IconChevronRight } from "@/components/icons";

export function SidebarSection({
  title,
  children,
  defaultOpen = true,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="mb-1">
      <button
        onClick={() => setOpen((o) => !o)}
        className="focus-ring flex w-full items-center gap-1 rounded-[3px] px-2 pb-1.5 text-[10.5px] font-medium uppercase tracking-[0.12em] text-[var(--color-text-faint)] transition-colors hover:text-[var(--color-text-muted)]"
      >
        {open ? <IconChevronDown width={12} height={12} /> : <IconChevronRight width={12} height={12} />}
        {title}
      </button>
      {open && <div className="flex flex-col gap-0.5">{children}</div>}
    </div>
  );
}
