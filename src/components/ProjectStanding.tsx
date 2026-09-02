"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button, Tag } from "@/components/ui";
import { IconPlus, IconTrash } from "@/components/icons";

export interface ProjectNote {
  id: string;
  kind: "decision" | "question";
  content: string;
  status: "proposed" | "open" | "settled" | "resolved";
  conversation_id: string | null;
  created_at: string;
  updated_at: string;
}
interface ActivityEntry {
  kind: string;
  id: string;
  title: string;
  at: string;
  href: string;
}
interface ProjectPerson {
  id: string;
  name: string;
  relationship: string | null;
  status: "established" | "suggested";
  // The association's own state. A person can be long established while their
  // membership of *this* Project is still only proposed.
  association_status: "established" | "suggested";
}

// Relative time, because "where the work stands" is a question about recency —
// "3 days ago" answers it and "2026-08-30" makes the reader do arithmetic.
function ago(iso: string): string {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 90) return "just now";
  const minutes = seconds / 60;
  if (minutes < 60) return `${Math.round(minutes)}m ago`;
  const hours = minutes / 60;
  if (hours < 24) return `${Math.round(hours)}h ago`;
  const days = hours / 24;
  if (days < 30) return `${Math.round(days)}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

const ACTIVITY_LABEL: Record<string, string> = {
  conversation: "Conversation",
  document: "Document",
  artifact: "Artifact",
  memory: "Memory",
  agent: "Agent",
  council: "Council",
  connection: "Connection",
  episode: "Episode closed",
  image: "Image",
};

// The Vision says a Project is a place, not a folder. A folder opens onto its
// contents; a place tells you where the work stands the moment you walk in —
// what's unresolved, what's settled, and what has been happening. That's what
// this band is, and it sits above the contents rather than among them.
export function ProjectStanding({ projectId }: { projectId: string }) {
  const [notes, setNotes] = useState<ProjectNote[]>([]);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [people, setPeople] = useState<ProjectPerson[]>([]);
  const [adding, setAdding] = useState<"decision" | "question" | null>(null);
  const [draft, setDraft] = useState("");

  const load = useCallback(async () => {
    const res = await fetch(`/api/projects/${projectId}/standing`);
    if (!res.ok) return;
    const data = await res.json();
    setNotes(data.notes ?? []);
    setActivity(data.activity ?? []);
    setPeople(data.people ?? []);
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  async function add() {
    const content = draft.trim();
    if (!content || !adding) return;
    await fetch("/api/project-notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, kind: adding, content }),
    });
    setDraft("");
    setAdding(null);
    load();
  }

  async function setStatus(id: string, status: ProjectNote["status"]) {
    await fetch(`/api/project-notes/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    load();
  }

  async function remove(id: string) {
    await fetch(`/api/project-notes/${id}`, { method: "DELETE" });
    load();
  }

  async function keepPerson(person: ProjectPerson) {
    // Two things can be un-kept here, and both have to be settled for someone
    // to appear on the roster the model actually sees.
    if (person.status === "suggested") {
      await fetch(`/api/people/${person.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "established" }),
      });
    }
    await fetch(`/api/people/${person.id}/projects`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, status: "established" }),
    });
    load();
  }

  // Discarding removes them from this Project, not from Magi — someone
  // proposed for the wrong Project is still a real person.
  async function dropPerson(person: ProjectPerson) {
    await fetch(`/api/people/${person.id}/projects?projectId=${projectId}`, { method: "DELETE" });
    load();
  }

  const questions = notes.filter((n) => n.kind === "question" && n.status !== "resolved");
  const decisions = notes.filter((n) => n.kind === "decision");
  const proposedPeople = people.filter((p) => p.status === "suggested" || p.association_status === "suggested");
  const proposedCount = notes.filter((n) => n.status === "proposed").length + proposedPeople.length;

  // Nothing recorded and nothing to show: say what this band is for rather
  // than rendering three empty boxes.
  if (!notes.length && !activity.length && !people.length) return null;

  return (
    <div className="border-b border-[var(--color-border)] px-8 py-6">
      <div className="mx-auto max-w-5xl">
        <div className="mb-3 flex items-baseline justify-between gap-4">
          <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--color-text-faint)] font-technical">
            Where the work stands
          </div>
          {proposedCount > 0 && (
            <div className="text-[11.5px] text-[var(--color-text-muted)]">
              {proposedCount} proposed by a closed episode — keep or discard below
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 gap-x-8 gap-y-6 lg:grid-cols-3">
          <NoteColumn
            title="Open questions"
            empty="Nothing recorded as open."
            notes={questions}
            keepStatus="open"
            resolveLabel="Resolve"
            resolveStatus="resolved"
            onSetStatus={setStatus}
            onRemove={remove}
            onAdd={() => setAdding("question")}
          />
          <NoteColumn
            title="Decisions"
            empty="Nothing settled yet."
            notes={decisions}
            keepStatus="settled"
            onSetStatus={setStatus}
            onRemove={remove}
            onAdd={() => setAdding("decision")}
          />

          <div>
            <div className="mb-2 text-[11px] uppercase tracking-[0.1em] text-[var(--color-text-faint)] font-technical">
              Recent activity
            </div>
            {activity.length === 0 ? (
              <p className="text-[12.5px] text-[var(--color-text-faint)]">Nothing yet.</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {activity.map((a) => (
                  <li key={`${a.kind}:${a.id}`} className="flex items-baseline gap-2 text-[12.5px]">
                    <span className="w-[52px] shrink-0 text-right font-technical text-[11px] text-[var(--color-text-faint)]">
                      {ago(a.at)}
                    </span>
                    <Link
                      href={a.href}
                      className="min-w-0 flex-1 truncate text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-accent)]"
                      title={`${ACTIVITY_LABEL[a.kind] ?? a.kind} — ${a.title}`}
                    >
                      <span className="text-[var(--color-text-faint)]">{ACTIVITY_LABEL[a.kind] ?? a.kind}</span>{" "}
                      {a.title}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* People sits under the grid rather than as a fourth column: it is a
            list of names, which reads as a strip and would waste a column. */}
        {people.length > 0 && (
          <div className="mt-5 border-t border-[var(--color-border)] pt-4">
            <div className="mb-2 text-[11px] uppercase tracking-[0.1em] text-[var(--color-text-faint)] font-technical">
              People
            </div>
            <ul className="flex flex-wrap items-center gap-x-4 gap-y-2">
              {people.map((p) => {
                const proposed = p.status === "suggested" || p.association_status === "suggested";
                return (
                  <li key={p.id} className="group flex items-center gap-1.5 text-[12.5px]">
                    <Link
                      href={`/people/${p.id}`}
                      className={`transition-colors hover:text-[var(--color-accent)] ${
                        proposed ? "text-[var(--color-text-muted)]" : "text-[var(--color-text)]"
                      }`}
                      title={p.relationship ?? undefined}
                    >
                      {p.name}
                    </Link>
                    {p.relationship && !proposed && (
                      <span className="text-[11px] text-[var(--color-text-faint)]">{p.relationship}</span>
                    )}
                    {/* Same rule as a proposed decision: the band announces
                        that there are proposals, so the action stays visible
                        rather than hiding behind a hover. */}
                    {proposed ? (
                      <>
                        <Tag>Proposed</Tag>
                        <button
                          onClick={() => keepPerson(p)}
                          className="text-[11px] text-[var(--color-accent)] transition-colors hover:underline"
                        >
                          Keep
                        </button>
                        <button
                          onClick={() => dropPerson(p)}
                          aria-label={`Remove ${p.name} from this Project`}
                          className="focus-ring text-[var(--color-text-faint)] transition-colors hover:text-[var(--color-danger)]"
                        >
                          <IconTrash />
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => dropPerson(p)}
                        aria-label={`Remove ${p.name} from this Project`}
                        className="focus-ring text-[var(--color-text-faint)] opacity-0 transition-opacity hover:text-[var(--color-danger)] group-hover:opacity-100"
                      >
                        <IconTrash />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {adding && (
          <div className="mt-4 flex items-center gap-2">
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") add();
                if (e.key === "Escape") {
                  setAdding(null);
                  setDraft("");
                }
              }}
              placeholder={adding === "question" ? "What's unresolved?" : "What was settled, and why?"}
              className="focus-ring flex-1 rounded-[3px] border border-[var(--color-border-strong)] bg-[var(--color-bg)] px-2.5 py-1.5 text-[13px] text-[var(--color-text)] placeholder:text-[var(--color-text-faint)]"
            />
            <Button variant="accent" onClick={add}>
              Add
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setAdding(null);
                setDraft("");
              }}
            >
              Cancel
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function NoteColumn({
  title,
  empty,
  notes,
  keepStatus,
  resolveLabel,
  resolveStatus,
  onSetStatus,
  onRemove,
  onAdd,
}: {
  title: string;
  empty: string;
  notes: ProjectNote[];
  keepStatus: ProjectNote["status"];
  resolveLabel?: string;
  resolveStatus?: ProjectNote["status"];
  onSetStatus: (id: string, status: ProjectNote["status"]) => void;
  onRemove: (id: string) => void;
  onAdd: () => void;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[11px] uppercase tracking-[0.1em] text-[var(--color-text-faint)] font-technical">
          {title}
        </div>
        <button
          onClick={onAdd}
          aria-label={`Add to ${title}`}
          className="focus-ring text-[var(--color-text-faint)] transition-colors hover:text-[var(--color-accent)]"
        >
          <IconPlus />
        </button>
      </div>
      {notes.length === 0 ? (
        <p className="text-[12.5px] text-[var(--color-text-faint)]">{empty}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {notes.map((n) => (
            <li key={n.id} className="group text-[12.5px] leading-relaxed">
              <div className={n.status === "proposed" ? "text-[var(--color-text-muted)]" : "text-[var(--color-text)]"}>
                {n.content}
              </div>
              {/* A proposal's Keep/discard stays visible: the band announces
                  that there are proposals to review, so hiding the action
                  behind a hover would be advertising a door with no handle.
                  Settled items reveal their controls on hover, since acting on
                  them is the exception. */}
              <div
                className={`mt-0.5 flex items-center gap-2 transition-opacity ${
                  n.status === "proposed" ? "" : "opacity-0 group-hover:opacity-100"
                }`}
              >
                {n.status === "proposed" ? (
                  <>
                    <Tag>Proposed</Tag>
                    <button
                      onClick={() => onSetStatus(n.id, keepStatus)}
                      className="text-[11px] text-[var(--color-accent)] transition-colors hover:underline"
                    >
                      Keep
                    </button>
                  </>
                ) : (
                  resolveStatus && (
                    <button
                      onClick={() => onSetStatus(n.id, resolveStatus)}
                      className="text-[11px] text-[var(--color-text-faint)] transition-colors hover:text-[var(--color-accent)]"
                    >
                      {resolveLabel}
                    </button>
                  )
                )}
                <button
                  onClick={() => onRemove(n.id)}
                  aria-label="Remove"
                  className="focus-ring text-[var(--color-text-faint)] transition-colors hover:text-[var(--color-danger)]"
                >
                  <IconTrash />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
