"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { IconSearch } from "@/components/icons";
import type { SearchResult } from "@/lib/searchIndex";

const STATIC_COMMANDS = [
  { title: "Home", href: "/", hint: "Workspace" },
  { title: "Projects", href: "/projects", hint: "Workspace" },
  { title: "New Project", href: "/projects?new=1", hint: "Create" },
  { title: "Archive", href: "/archive", hint: "Workspace" },
  { title: "Memory", href: "/memory", hint: "Workspace" },
  { title: "Image Lab", href: "/image-lab", hint: "Workspace" },
  { title: "Councils", href: "/councils", hint: "Workspace" },
  { title: "Skills", href: "/skills", hint: "Workspace" },
  { title: "Settings", href: "/settings", hint: "Configure" },
];

const KIND_LABEL: Record<string, string> = {
  project: "Project",
  conversation: "Conversation",
  message: "Message",
  memory: "Memory",
  document: "Document",
  artifact: "Artifact",
  skill: "Skill",
  style_guide: "Style Guide",
  character: "Character",
};

function hrefFor(r: SearchResult): string {
  switch (r.kind) {
    case "project":
      return `/projects/${r.refId}`;
    case "conversation":
      return `/projects/${r.projectId}/c/${r.refId}`;
    case "message":
      return `/projects/${r.projectId}`;
    case "memory":
      return `/memory`;
    case "document":
      return `/projects/${r.projectId}`;
    case "artifact":
      return `/projects/${r.projectId}`;
    case "skill":
      return `/skills`;
    case "style_guide":
    case "character":
      return `/image-lab?project=${r.projectId}`;
    default:
      return "/";
  }
}

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (open) {
      setQuery("");
      setResults([]);
      setIndex(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    const handle = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
        const data = await res.json();
        setResults(data.results ?? []);
      } catch {
        setResults([]);
      }
    }, 150);
    return () => clearTimeout(handle);
  }, [query]);

  const staticMatches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return STATIC_COMMANDS;
    return STATIC_COMMANDS.filter((c) => c.title.toLowerCase().includes(q));
  }, [query]);

  const items = useMemo(
    () => [
      ...staticMatches.map((c) => ({ type: "static" as const, title: c.title, subtitle: c.hint, href: c.href })),
      ...results.map((r) => ({
        type: "result" as const,
        title: r.title,
        subtitle: `${KIND_LABEL[r.kind] ?? r.kind} — ${r.snippet.replace(/⟦|⟧/g, "")}`,
        href: hrefFor(r),
      })),
    ],
    [staticMatches, results]
  );

  useEffect(() => setIndex(0), [items.length]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!open) return;
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setIndex((i) => Math.min(i + 1, items.length - 1));
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setIndex((i) => Math.max(i - 1, 0));
      }
      if (e.key === "Enter") {
        const item = items[index];
        if (item) {
          router.push(item.href);
          onClose();
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, items, index, onClose, router]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 pt-[14vh]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-[4px] border border-[var(--color-border-strong)] bg-[var(--color-bg-raised)] shadow-[0_8px_28px_rgba(0,0,0,0.28)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 border-b border-[var(--color-border)] px-4 py-3">
          <IconSearch className="text-[var(--color-text-faint)]" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search projects, conversations, memory, skills…"
            className="w-full bg-transparent text-[14px] text-[var(--color-text)] placeholder:text-[var(--color-text-faint)] outline-none"
          />
          <kbd className="rounded-[3px] border border-[var(--color-border)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-faint)] font-technical">
            esc
          </kbd>
        </div>
        <div className="max-h-[50vh] overflow-y-auto py-1.5">
          {items.length === 0 && (
            <div className="px-4 py-6 text-center text-[13px] text-[var(--color-text-faint)]">
              No matches
            </div>
          )}
          {items.map((item, i) => (
            <button
              key={`${item.type}-${item.href}-${i}`}
              onClick={() => {
                router.push(item.href);
                onClose();
              }}
              onMouseEnter={() => setIndex(i)}
              className="flex w-full flex-col items-start gap-0.5 px-4 py-2 text-left transition-colors"
              style={{
                background: i === index ? "var(--color-surface-2)" : "transparent",
              }}
            >
              <span className="text-[13.5px] text-[var(--color-text)]">{item.title}</span>
              {item.subtitle && (
                <span className="truncate text-[11.5px] text-[var(--color-text-faint)] max-w-full">
                  {item.subtitle}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
