"use client";

import { useEffect, useState } from "react";
import { IconMoon, IconSun } from "@/components/icons";

export function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark" | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem("magi-theme") as "light" | "dark" | null;
    if (stored) {
      setTheme(stored);
    } else {
      setTheme(window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    }
  }, []);

  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    localStorage.setItem("magi-theme", next);
    document.documentElement.setAttribute("data-theme", next);
  }

  return (
    <button
      onClick={toggle}
      className="focus-ring flex items-center gap-2 rounded-[3px] border border-[var(--color-border)] px-2 py-1.5 text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-border-strong)] transition-colors"
      title="Toggle light / dark"
    >
      {theme === "dark" ? <IconSun /> : <IconMoon />}
    </button>
  );
}
