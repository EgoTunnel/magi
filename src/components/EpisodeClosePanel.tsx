"use client";

import { useState } from "react";
import { Button, Panel, Tag } from "@/components/ui";
import { IconTrash } from "@/components/icons";
import { MagiSpinner } from "@/components/MagiSpinner";

export interface ClosureNote {
  id: string;
  kind: "decision" | "question";
  content: string;
  status: "proposed" | "open" | "settled" | "resolved";
}
export interface ClosureMemory {
  id: string;
  scope: "global" | "project";
  content: string;
  status: "established" | "suggested";
}
export interface ClosureDraft {
  closure: { id: string; summary: string; message_count: number; status: "draft" | "reviewed"; created_at: string };
  notes: ClosureNote[];
  memory: ClosureMemory[];
}

// The end of an episode: what this conversation settled, what it left open, and
// what is worth remembering. Every row here is a proposal in a state nothing
// acts on — a suggested memory item never reaches a prompt, a proposed decision
// never reaches the Project — until it is kept from this panel.
export function EpisodeClosePanel({
  draft,
  drafting,
  error,
  onDraft,
  onChanged,
  onDismiss,
}: {
  draft: ClosureDraft | null;
  drafting: boolean;
  error: string | null;
  onDraft: () => void;
  onChanged: () => void;
  onDismiss: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);

  async function act(id: string, run: () => Promise<unknown>) {
    setBusy(id);
    await run();
    setBusy(null);
    onChanged();
  }

  const keepNote = (note: ClosureNote) =>
    act(note.id, () =>
      fetch(`/api/project-notes/${note.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: note.kind === "decision" ? "settled" : "open" }),
      })
    );
  const dropNote = (note: ClosureNote) =>
    act(note.id, () => fetch(`/api/project-notes/${note.id}`, { method: "DELETE" }));
  const keepMemory = (item: ClosureMemory) =>
    act(item.id, () =>
      fetch(`/api/memory/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "established" }),
      })
    );
  const dropMemory = (item: ClosureMemory) =>
    act(item.id, () => fetch(`/api/memory/${item.id}`, { method: "DELETE" }));

  const decisions = draft?.notes.filter((n) => n.kind === "decision") ?? [];
  const questions = draft?.notes.filter((n) => n.kind === "question") ?? [];
  const projectMemory = draft?.memory.filter((m) => m.scope === "project") ?? [];
  const globalMemory = draft?.memory.filter((m) => m.scope === "global") ?? [];
  const pending =
    (draft?.notes.filter((n) => n.status === "proposed").length ?? 0) +
    (draft?.memory.filter((m) => m.status === "suggested").length ?? 0);

  return (
    <Panel className="px-5 py-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--color-text-faint)] font-technical">
          Close this episode
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={onDismiss}>
            Hide
          </Button>
          <Button variant="accent" onClick={onDraft} disabled={drafting}>
            {drafting ? "Reading…" : draft ? "Draft again" : "Draft close-out"}
          </Button>
        </div>
      </div>

      {error && <div className="mb-3 text-[12.5px] text-[var(--color-danger)]">{error}</div>}

      {drafting && (
        <div className="flex items-center gap-2 py-4 text-[12.5px] text-[var(--color-text-muted)]">
          <MagiSpinner /> Reading the conversation and drafting what should outlive it…
        </div>
      )}

      {!draft && !drafting && !error && (
        <p className="text-[12.5px] leading-relaxed text-[var(--color-text-muted)]">
          Reads the whole conversation and drafts a summary, the decisions it settled, the questions it left
          open, and what might be worth remembering. Nothing is kept until you say so — every proposal stays
          inert until you keep it.
        </p>
      )}

      {draft && !drafting && (
        <div className="flex flex-col gap-4 text-[13px]">
          <div>
            <div className="mb-1 text-[11px] uppercase tracking-[0.1em] text-[var(--color-text-faint)] font-technical">
              Summary of {draft.closure.message_count} messages
            </div>
            <p className="whitespace-pre-wrap leading-relaxed text-[var(--color-text)]">{draft.closure.summary}</p>
          </div>

          <ReviewSection
            title="Decisions"
            empty="Nothing was settled here."
            items={decisions}
            busy={busy}
            keptLabel="Kept"
            onKeep={keepNote}
            onDrop={dropNote}
            isKept={(n) => n.status !== "proposed"}
            render={(n) => n.content}
            keyOf={(n) => n.id}
          />
          <ReviewSection
            title="Open questions"
            empty="Nothing was left open."
            items={questions}
            busy={busy}
            keptLabel="Kept"
            onKeep={keepNote}
            onDrop={dropNote}
            isKept={(n) => n.status !== "proposed"}
            render={(n) => n.content}
            keyOf={(n) => n.id}
          />
          <ReviewSection
            title="Remember in this Project"
            empty="Nothing durable proposed."
            items={projectMemory}
            busy={busy}
            keptLabel="Established"
            onKeep={keepMemory}
            onDrop={dropMemory}
            isKept={(m) => m.status === "established"}
            render={(m) => m.content}
            keyOf={(m) => m.id}
          />
          {globalMemory.length > 0 && (
            <ReviewSection
              title="Remember globally"
              empty=""
              items={globalMemory}
              busy={busy}
              keptLabel="Established"
              onKeep={keepMemory}
              onDrop={dropMemory}
              isKept={(m) => m.status === "established"}
              render={(m) => m.content}
              keyOf={(m) => m.id}
            />
          )}

          <p className="text-[12px] leading-relaxed text-[var(--color-text-faint)]">
            {pending > 0
              ? `${pending} proposal(s) still un-reviewed. Anything you leave stays as a suggestion — visible on the Memory page and the Project dashboard, never used in a reply.`
              : "Everything here has been reviewed."}
          </p>
        </div>
      )}
    </Panel>
  );
}

function ReviewSection<T>({
  title,
  empty,
  items,
  busy,
  keptLabel,
  onKeep,
  onDrop,
  isKept,
  render,
  keyOf,
}: {
  title: string;
  empty: string;
  items: T[];
  busy: string | null;
  keptLabel: string;
  onKeep: (item: T) => void;
  onDrop: (item: T) => void;
  isKept: (item: T) => boolean;
  render: (item: T) => string;
  keyOf: (item: T) => string;
}) {
  return (
    <div>
      <div className="mb-1.5 text-[11px] uppercase tracking-[0.1em] text-[var(--color-text-faint)] font-technical">
        {title}
      </div>
      {items.length === 0 ? (
        empty ? (
          <p className="text-[12.5px] text-[var(--color-text-faint)]">{empty}</p>
        ) : null
      ) : (
        <ul className="flex flex-col gap-1.5">
          {items.map((item) => {
            const kept = isKept(item);
            return (
              <li
                key={keyOf(item)}
                className="flex items-start justify-between gap-3 rounded-[3px] border border-[var(--color-border)] px-3 py-2"
              >
                <span className={`leading-relaxed ${kept ? "text-[var(--color-text)]" : "text-[var(--color-text-muted)]"}`}>
                  {render(item)}
                </span>
                <div className="flex shrink-0 items-center gap-2">
                  {kept ? (
                    <Tag tone="accent">{keptLabel}</Tag>
                  ) : (
                    <Button variant="ghost" onClick={() => onKeep(item)} disabled={busy === keyOf(item)}>
                      Keep
                    </Button>
                  )}
                  <button
                    onClick={() => onDrop(item)}
                    disabled={busy === keyOf(item)}
                    aria-label="Discard"
                    className="focus-ring text-[var(--color-text-faint)] transition-colors hover:text-[var(--color-danger)] disabled:opacity-40"
                  >
                    <IconTrash />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
