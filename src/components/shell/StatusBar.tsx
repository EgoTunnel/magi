"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { IconCommand } from "@/components/icons";

export function StatusBar({ onOpenPalette }: { onOpenPalette: () => void }) {
  const pathname = usePathname();
  const [projectName, setProjectName] = useState<string | null>(null);
  const [conversationTitle, setConversationTitle] = useState<string | null>(null);
  const [modelLabel, setModelLabel] = useState<string | null>(null);
  const [todaySpend, setTodaySpend] = useState<{ costUsd: number; hasUnpricedEvents: boolean } | null>(null);

  const parts = pathname.split("/").filter(Boolean);
  const projectId = parts[0] === "projects" ? parts[1] : null;
  const conversationId = parts[0] === "projects" && parts[2] === "c" ? parts[3] : null;

  useEffect(() => {
    let cancelled = false;
    if (!projectId) {
      setProjectName(null);
      return;
    }
    fetch(`/api/projects/${projectId}`)
      .then((r) => r.json())
      .then((d) => !cancelled && setProjectName(d.project?.name ?? null))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;
    if (!conversationId) {
      setConversationTitle(null);
      return;
    }
    fetch(`/api/conversations/${conversationId}`)
      .then((r) => r.json())
      .then((d) => !cancelled && setConversationTitle(d.conversation?.title ?? null))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/models")
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        const defaultModelId = d.assignments?.default;
        const model = (d.models ?? []).find((m: { id: string }) => m.id === defaultModelId);
        setModelLabel(model?.label ?? defaultModelId ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/usage")
      .then((r) => r.json())
      .then((d) => !cancelled && setTodaySpend(d.today ?? null))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  const crumbs = [projectName, conversationTitle].filter(Boolean) as string[];

  return (
    <div className="flex h-8 shrink-0 items-center justify-between border-t border-[var(--color-border)] bg-[var(--color-bg-raised)] px-3 text-[11.5px] text-[var(--color-text-faint)]">
      <div className="flex items-center gap-1.5 truncate font-technical">
        {crumbs.length > 0 ? (
          crumbs.map((c, i) => (
            <span key={i} className="flex items-center gap-1.5 truncate">
              {i > 0 && <span className="opacity-50">/</span>}
              <span className="truncate text-[var(--color-text-muted)]">{c}</span>
            </span>
          ))
        ) : (
          <span>Magi</span>
        )}
        {modelLabel && (
          <span className="ml-2 flex items-center gap-1.5 opacity-70">
            <span className="opacity-50">·</span>
            {modelLabel}
          </span>
        )}
        {todaySpend && (todaySpend.costUsd > 0 || todaySpend.hasUnpricedEvents) && (
          <span className="ml-2 flex items-center gap-1.5 opacity-70">
            <span className="opacity-50">·</span>
            {`$${todaySpend.costUsd.toFixed(todaySpend.costUsd < 1 ? 4 : 2)}${todaySpend.hasUnpricedEvents ? "+" : ""} today`}
          </span>
        )}
      </div>
      <button
        onClick={onOpenPalette}
        className="focus-ring flex items-center gap-1.5 rounded-[3px] px-1.5 py-0.5 hover:text-[var(--color-text)] transition-colors"
      >
        <IconCommand />
        <span className="font-technical">K</span>
      </button>
    </div>
  );
}
