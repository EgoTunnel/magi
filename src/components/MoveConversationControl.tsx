"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui";

interface ProjectOption {
  id: string;
  name: string;
}

// A small popover, not a page navigation — reused as-is in both
// ConversationView's header toolbar and ProjectDashboard's conversation
// list rows, so a conversation can be reassigned to a different Project
// from wherever it's actually being looked at.
export function MoveConversationControl({
  conversationId,
  currentProjectId,
  onMoved,
}: {
  conversationId: string;
  currentProjectId: string;
  onMoved: (newProjectId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [targetId, setTargetId] = useState("");
  const [moving, setMoving] = useState(false);

  useEffect(() => {
    if (!open) return;
    fetch("/api/projects")
      .then((r) => r.json())
      .then((d) => setProjects((d.projects ?? []).filter((p: ProjectOption) => p.id !== currentProjectId)));
  }, [open, currentProjectId]);

  async function move() {
    if (!targetId) return;
    setMoving(true);
    await fetch(`/api/conversations/${conversationId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: targetId }),
    });
    setMoving(false);
    setOpen(false);
    setTargetId("");
    onMoved(targetId);
  }

  return (
    <div className="relative" onClick={(e) => e.preventDefault()}>
      <Button
        variant="ghost"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        Move
      </Button>
      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute right-0 top-full z-20 mt-1 flex w-56 flex-col gap-2 rounded-[4px] border border-[var(--color-border)] bg-[var(--color-bg-raised)] p-2.5 shadow-lg"
        >
          <select
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
            className="focus-ring rounded-[3px] border border-[var(--color-border-strong)] bg-[var(--color-bg)] px-2 py-1.5 text-[12.5px] text-[var(--color-text)]"
          >
            <option value="">Move to…</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <div className="flex justify-end gap-1.5">
            <Button
              variant="ghost"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="accent"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                move();
              }}
              disabled={!targetId || moving}
            >
              {moving ? "Moving…" : "Move"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
