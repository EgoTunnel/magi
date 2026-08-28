"use client";

import { ReactNode, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { CommandPalette } from "@/components/shell/CommandPalette";
import { StatusBar } from "@/components/shell/StatusBar";

function MenuIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" width={18} height={18}>
      <path d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}

export function WorkspaceShell({ sidebar, children }: { sidebar: ReactNode; children: ReactNode }) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Close the mobile drawer on navigation.
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <div
        className={`fixed inset-y-0 left-0 z-40 -translate-x-full transition-transform duration-200 md:static md:z-auto md:translate-x-0 ${
          drawerOpen ? "translate-x-0" : ""
        }`}
      >
        {sidebar}
      </div>
      {drawerOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/30 md:hidden"
          onClick={() => setDrawerOpen(false)}
        />
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-11 shrink-0 items-center gap-3 border-b border-[var(--color-border)] px-3 md:hidden">
          <button
            onClick={() => setDrawerOpen((o) => !o)}
            className="focus-ring flex h-7 w-7 items-center justify-center rounded-[3px] text-[var(--color-text-muted)]"
            aria-label="Open menu"
          >
            <MenuIcon />
          </button>
          <span className="text-[13px] font-semibold tracking-[0.14em] uppercase text-[var(--color-text)]">
            Magi
          </span>
        </div>
        <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
        <StatusBar onOpenPalette={() => setPaletteOpen(true)} />
      </div>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}
