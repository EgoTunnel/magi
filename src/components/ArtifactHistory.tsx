"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Button, Tag } from "@/components/ui";
import { IconDocument, IconDownload } from "@/components/icons";
import { renderMarkdown } from "@/lib/markdownToReact";

interface ArtifactVersion {
  id: string;
  title: string;
  content: string;
  version: number;
  created_at: string;
  mime_type: string | null;
}

// The click target for "view this artifact," used wherever an artifact
// appears (a conversation's file chips, the Project dashboard's Artifacts
// list). Defaults to a document-icon label if the caller doesn't supply
// its own clickable content.
export function ArtifactViewerButton({
  artifactId,
  onRestored,
  className,
  children,
}: {
  artifactId: string;
  onRestored?: () => void;
  className?: string;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
        className={className ?? "focus-ring flex items-center gap-1.5 text-left text-[13.5px] text-[var(--color-text)] hover:text-[var(--color-accent)] transition-colors"}
      >
        {children ?? (
          <>
            <IconDocument className="shrink-0" />
            View artifact
          </>
        )}
      </button>
      {open && (
        <ArtifactViewerModal artifactId={artifactId} onClose={() => setOpen(false)} onRestored={onRestored} />
      )}
    </>
  );
}

function ArtifactViewerModal({
  artifactId,
  onClose,
  onRestored,
}: {
  artifactId: string;
  onClose: () => void;
  onRestored?: () => void;
}) {
  const [versions, setVersions] = useState<ArtifactVersion[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [restoring, setRestoring] = useState(false);

  async function load() {
    setLoading(true);
    const res = await fetch(`/api/artifacts/${artifactId}`);
    const data = await res.json();
    const list: ArtifactVersion[] = data.versions ?? [];
    setVersions(list);
    setSelected((prev) => (prev && list.some((v) => v.id === prev) ? prev : (list[list.length - 1]?.id ?? null)));
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artifactId]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const latest = versions[versions.length - 1];
  const current = versions.find((v) => v.id === selected) ?? null;
  // createNewVersion() only ever writes the content column — a file-backed
  // version's actual .docx (see saveDocxArtifact in repo/artifacts.ts) would
  // go stale if "restored" this way, so restoring is offered only for plain
  // content artifacts.
  const restorable = !!current && !!latest && current.id !== latest.id && !latest.mime_type;

  async function restore(version: ArtifactVersion) {
    if (!latest) return;
    setRestoring(true);
    try {
      await fetch(`/api/artifacts/${latest.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: version.content, title: version.title }),
      });
      onRestored?.();
      onClose();
    } finally {
      setRestoring(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      onClick={onClose}
    >
      <div
        className="flex h-[85vh] w-full max-w-4xl overflow-hidden rounded-[6px] border border-[var(--color-border)] bg-[var(--color-bg)] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-44 shrink-0 overflow-y-auto border-r border-[var(--color-border)] py-2">
          <div className="px-3 py-1.5 text-[10.5px] font-medium uppercase tracking-[0.1em] text-[var(--color-text-faint)] font-technical">
            Versions
          </div>
          {loading ? (
            <div className="px-3 py-2 text-[12px] text-[var(--color-text-faint)]">Loading…</div>
          ) : (
            versions
              .slice()
              .reverse()
              .map((v) => (
                <button
                  key={v.id}
                  onClick={() => setSelected(v.id)}
                  className={`flex w-full items-center justify-between px-3 py-2 text-left text-[12.5px] transition-colors ${
                    v.id === selected
                      ? "bg-[var(--color-surface)] text-[var(--color-text)]"
                      : "text-[var(--color-text-muted)] hover:bg-[var(--color-surface)]"
                  }`}
                >
                  <span>v{v.version}</span>
                  {v.id === latest?.id && <Tag tone="accent">latest</Tag>}
                </button>
              ))
          )}
        </div>
        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-3">
            <div className="min-w-0">
              <div className="truncate text-[15px] font-medium text-[var(--color-text)]">{current?.title}</div>
              {current && (
                <div className="text-[11.5px] text-[var(--color-text-faint)] font-technical">
                  v{current.version} · {new Date(current.created_at).toLocaleString()}
                </div>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {current?.mime_type && (
                <a href={`/api/artifacts/${current.id}/file`} download>
                  <Button variant="ghost">
                    <IconDownload /> Download
                  </Button>
                </a>
              )}
              {restorable && (
                <Button variant="ghost" onClick={() => current && restore(current)} disabled={restoring}>
                  {restoring ? "Restoring…" : "Restore this version"}
                </Button>
              )}
              <button
                onClick={onClose}
                className="focus-ring px-1 text-[var(--color-text-faint)] hover:text-[var(--color-text)]"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
          </div>
          {latest?.mime_type && (
            <div className="border-b border-[var(--color-border)] px-5 py-2 text-[11.5px] text-[var(--color-text-faint)]">
              This artifact is backed by a downloadable file — content is shown for reference; restoring an
              older version isn&apos;t supported yet.
            </div>
          )}
          <div className="flex-1 overflow-y-auto px-6 py-5">
            {current ? (
              <div className="prose-magi max-w-none">{renderMarkdown(current.content)}</div>
            ) : loading ? (
              <p className="text-[13px] text-[var(--color-text-faint)]">Loading…</p>
            ) : (
              <p className="text-[13px] text-[var(--color-text-faint)]">This artifact has no versions.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
