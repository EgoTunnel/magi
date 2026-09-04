"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, EmptyState, Input, Label, PageHeader, Panel, Tag, Textarea } from "@/components/ui";
import { IconPlus, IconTrash } from "@/components/icons";
import { parseAliases } from "../PeopleClient";
import { KIND_LABEL, TrajectoryTimeline, type TimelineTrajectory } from "@/components/TrajectoryTimeline";
import { linkPersonNames } from "@/components/PersonNames";

interface Person {
  id: string;
  name: string;
  aliases: string[];
  relationship: string | null;
  summary: string | null;
  suggested_summary: string | null;
  status: "established" | "suggested";
  created_at: string;
}
interface Fact {
  id: string;
  content: string;
  status: "established" | "suggested" | "superseded";
  superseded_by: string | null;
  source_message_id: string | null;
  source_conversation_id: string | null;
  sourceLink: { href: string; context: string } | null;
  created_at: string;
}
interface OriginCandidate {
  messageId: string;
  conversationId: string;
  conversationTitle: string;
  role: string;
  date: string;
  preview: string;
  href: string | null;
  context: string | null;
}
interface PersonProject {
  id: string;
  name: string;
  role: string | null;
  // Proposed by closing a conversation, and not yet kept — so they are not on
  // that Project's roster and Magi is not told they are involved in it.
  status: "established" | "suggested";
}
interface Mention {
  chunkId: string;
  kind: string;
  title: string;
  date: string;
  content: string;
  matchedBy: "meaning" | "keyword" | "both";
  href: string | null;
  context: string | null;
}
interface ProjectOption {
  id: string;
  name: string;
}

export function PersonView({ personId }: { personId: string }) {
  const router = useRouter();
  const [person, setPerson] = useState<Person | null>(null);
  const [facts, setFacts] = useState<Fact[]>([]);
  const [projects, setProjects] = useState<PersonProject[]>([]);
  const [allProjects, setAllProjects] = useState<ProjectOption[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [mentions, setMentions] = useState<Mention[] | null>(null);
  const [loaded, setLoaded] = useState(false);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ name: "", relationship: "", summary: "", aliases: "" });
  const [newFact, setNewFact] = useState("");
  const [addProjectId, setAddProjectId] = useState("");
  const [mergeId, setMergeId] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Opt-in rather than automatic: it is a larger retrieval pass than Mentions,
  // and most visits to this page are to read what is known, not the history.
  const [showTrajectory, setShowTrajectory] = useState(false);
  const [trajectory, setTrajectory] = useState<TimelineTrajectory | null>(null);
  const [mentionScope, setMentionScope] = useState<"projects" | "everywhere">("projects");
  const [mentionMeta, setMentionMeta] = useState<{
    scope: string;
    scopedProjectCount: number;
    everywhereCount: number;
    fellBack: boolean;
  } | null>(null);
  const [showSuperseded, setShowSuperseded] = useState(false);
  const [supersedesId, setSupersedesId] = useState("");
  const [originFor, setOriginFor] = useState<string | null>(null);
  const [originCandidates, setOriginCandidates] = useState<OriginCandidate[] | null>(null);
  const [draftingSummary, setDraftingSummary] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/people/${personId}`);
    if (!res.ok) {
      setLoaded(true);
      return;
    }
    const data = await res.json();
    setPerson(data.person);
    setFacts(data.facts);
    setProjects(data.projects);
    setLoaded(true);
  }, [personId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    fetch("/api/projects")
      .then((r) => r.json())
      .then((d) => setAllProjects(d.projects ?? []))
      .catch(() => setAllProjects([]));
    fetch("/api/people")
      .then((r) => r.json())
      .then((d) => setPeople(d.people ?? []))
      .catch(() => setPeople([]));
  }, []);

  // Mentions are a retrieval pass over the whole archive, so they load on their
  // own rather than holding up the facts the page is actually about.
  useEffect(() => {
    let cancelled = false;
    setMentions(null);
    fetch(`/api/people/${personId}/mentions?scope=${mentionScope}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        setMentions(d.mentions ?? []);
        setMentionMeta({
          scope: d.scope,
          scopedProjectCount: d.scopedProjectCount ?? 0,
          everywhereCount: d.everywhereCount ?? 0,
          fellBack: !!d.fellBack,
        });
      })
      .catch(() => {
        if (!cancelled) setMentions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [personId, mentionScope]);

  useEffect(() => {
    if (!showTrajectory) return;
    let cancelled = false;
    fetch(`/api/people/${personId}/trajectory`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setTrajectory(d.trajectory ?? null);
      })
      .catch(() => {
        if (!cancelled) setTrajectory(null);
      });
    return () => {
      cancelled = true;
    };
  }, [showTrajectory, personId]);

  async function saveEdit() {
    await fetch(`/api/people/${personId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: draft.name,
        relationship: draft.relationship.trim() || null,
        summary: draft.summary.trim() || null,
        aliases: parseAliases(draft.aliases),
      }),
    });
    setEditing(false);
    load();
  }

  async function addFact() {
    if (!newFact.trim()) return;
    await fetch(`/api/people/${personId}/facts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: newFact, supersedesId: supersedesId || undefined }),
    });
    setNewFact("");
    setSupersedesId("");
    load();
  }

  async function supersede(id: string) {
    await fetch(`/api/memory/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "superseded" }),
    });
    load();
  }

  async function findOrigin(id: string) {
    setOriginFor(id);
    setOriginCandidates(null);
    const res = await fetch(`/api/memory/${id}/origin`);
    setOriginCandidates((await res.json()).candidates ?? []);
  }

  async function linkOrigin(factId: string, c: OriginCandidate) {
    await fetch(`/api/memory/${factId}/origin`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageId: c.messageId, conversationId: c.conversationId }),
    });
    setOriginFor(null);
    setOriginCandidates(null);
    load();
  }

  async function draftSummary() {
    setDraftingSummary(true);
    setSummaryError(null);
    const res = await fetch(`/api/people/${personId}/summary`, { method: "POST" });
    setDraftingSummary(false);
    if (!res.ok) {
      setSummaryError((await res.json()).message ?? "Could not draft a summary.");
      return;
    }
    load();
  }

  async function resolveSummary(accept: boolean) {
    await fetch(`/api/people/${personId}/summary`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accept }),
    });
    load();
  }

  async function setFactStatus(id: string, status: "established" | "suggested") {
    await fetch(`/api/memory/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    load();
  }

  async function removeFact(id: string) {
    await fetch(`/api/memory/${id}`, { method: "DELETE" });
    load();
  }

  async function addProject() {
    if (!addProjectId) return;
    await fetch(`/api/people/${personId}/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: addProjectId }),
    });
    setAddProjectId("");
    load();
  }

  async function keepProject(projectId: string) {
    await fetch(`/api/people/${personId}/projects`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, status: "established" }),
    });
    load();
  }

  async function removeProject(projectId: string) {
    await fetch(`/api/people/${personId}/projects?projectId=${projectId}`, { method: "DELETE" });
    load();
  }

  async function merge() {
    if (!mergeId) return;
    await fetch(`/api/people/${personId}/merge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ intoId: mergeId }),
    });
    router.push(`/people/${mergeId}`);
  }

  async function remove() {
    await fetch(`/api/people/${personId}`, { method: "DELETE" });
    router.push("/people");
  }

  if (!loaded) {
    return <div className="px-8 py-8 text-[13px] text-[var(--color-text-muted)]">Loading…</div>;
  }
  if (!person) {
    return (
      <div className="px-8 py-8">
        <EmptyState title="No such person" description="They may have been deleted." action={<Link className="text-[13px] text-[var(--color-accent)]" href="/people">Back to People</Link>} />
      </div>
    );
  }

  const established = facts.filter((f) => f.status === "established");
  const suggested = facts.filter((f) => f.status === "suggested");
  const superseded = facts.filter((f) => f.status === "superseded");
  const link = (text: string) => linkPersonNames(text, people, personId);
  const unassigned = allProjects.filter((p) => !projects.some((x) => x.id === p.id));
  const mergeCandidates = people.filter((p) => p.id !== personId);

  return (
    <div>
      <PageHeader
        eyebrow={person.status === "suggested" ? "Suggested — not yet kept" : "Person"}
        title={person.name}
        description={person.summary ?? undefined}
        actions={
          <>
            <a
              href={`/api/people/${personId}/export`}
              className="focus-ring inline-flex items-center justify-center rounded-[3px] border border-[var(--color-border-strong)] bg-[var(--color-bg-raised)] px-3 py-1.5 text-[13px] font-medium text-[var(--color-text)] hover:bg-[var(--color-surface-2)] transition-colors"
            >
              Export
            </a>
            <Button onClick={draftSummary} disabled={draftingSummary || !!person.suggested_summary}>
              {draftingSummary ? "Drafting…" : "Draft summary"}
            </Button>
            <Button
              onClick={() => {
                setDraft({
                  name: person.name,
                  relationship: person.relationship ?? "",
                  summary: person.summary ?? "",
                  aliases: person.aliases.join(", "),
                });
                setEditing((v) => !v);
              }}
            >
              Edit
            </Button>
          </>
        }
      />

      <div className="mx-auto max-w-3xl px-8 py-8">
        {/* A drafted summary is a proposal, exactly like a proposed fact:
            it sits beside the real one and changes nothing until kept. */}
        {person.suggested_summary && (
          <Panel className="mb-5 px-4 py-3">
            <div className="mb-1 text-[11px] uppercase tracking-[0.1em] text-[var(--color-text-faint)] font-technical">
              Suggested summary
            </div>
            <p className="text-[13.5px] leading-relaxed text-[var(--color-text-muted)]">{person.suggested_summary}</p>
            <div className="mt-2 flex items-center gap-2">
              <Button variant="ghost" onClick={() => resolveSummary(true)}>
                Keep
              </Button>
              <Button variant="ghost" onClick={() => resolveSummary(false)}>
                Discard
              </Button>
            </div>
          </Panel>
        )}
        {summaryError && <div className="mb-4 text-[12.5px] text-[var(--color-danger)]">{summaryError}</div>}

        <div className="mb-6 flex flex-wrap items-center gap-2">
          {person.relationship && <Tag tone="accent">{person.relationship}</Tag>}
          {person.aliases.map((a) => (
            <Tag key={a}>also: {a}</Tag>
          ))}
          {person.status === "suggested" && (
            <Button
              variant="ghost"
              onClick={async () => {
                await fetch(`/api/people/${personId}`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ status: "established" }),
                });
                load();
              }}
            >
              Keep this person
            </Button>
          )}
        </div>

        {editing && (
          <Panel className="mb-8 px-5 py-5">
            <Label>Name</Label>
            <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            <div className="mt-3">
              <Label>Relationship</Label>
              <Input
                value={draft.relationship}
                onChange={(e) => setDraft({ ...draft, relationship: e.target.value })}
                placeholder="colleague at Acme · client · collaborator"
              />
            </div>
            <div className="mt-3">
              <Label>Summary</Label>
              <Textarea
                value={draft.summary}
                onChange={(e) => setDraft({ ...draft, summary: e.target.value })}
                rows={2}
              />
            </div>
            <div className="mt-3">
              <Label>Also known as</Label>
              <Input
                value={draft.aliases}
                onChange={(e) => setDraft({ ...draft, aliases: e.target.value })}
                placeholder="Exact alternate names, comma-separated"
              />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <Button variant="accent" onClick={saveEdit}>
                Save
              </Button>
            </div>
          </Panel>
        )}

        {/* 1 — What I know */}
        <section className="mb-9">
          <h2 className="mb-2.5 text-[13px] font-semibold uppercase tracking-[0.1em] text-[var(--color-text-faint)] font-technical">
            What I know
          </h2>

          {suggested.length > 0 && (
            <div className="mb-4">
              <p className="mb-2 text-[12.5px] text-[var(--color-text-muted)]">
                Proposed by closing a conversation. Nothing here counts as known, or reaches a reply, until you keep it.
              </p>
              <div className="flex flex-col gap-1.5">
                {suggested.map((fact) => (
                  <Panel key={fact.id} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <span className="text-[13px] leading-relaxed text-[var(--color-text-muted)]">{fact.content}</span>
                        <FactOrigin fact={fact} />
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Button variant="ghost" onClick={() => setFactStatus(fact.id, "established")}>
                          Keep
                        </Button>
                        <button
                          onClick={() => removeFact(fact.id)}
                          aria-label="Discard"
                          className="focus-ring text-[var(--color-text-faint)] hover:text-[var(--color-danger)]"
                        >
                          <IconTrash />
                        </button>
                      </div>
                    </div>
                  </Panel>
                ))}
              </div>
            </div>
          )}

          {established.length === 0 ? (
            <EmptyState
              title="Nothing recorded yet"
              description="Write down what you know about them. Each fact keeps its date and, when it came from a conversation, a link back to where you learned it."
            />
          ) : (
            <div className="flex flex-col gap-1.5">
              {established.map((fact) => (
                <Panel key={fact.id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <span className="text-[13px] leading-relaxed text-[var(--color-text)]">{link(fact.content)}</span>
                      <FactOrigin fact={fact} onFindOrigin={() => findOrigin(fact.id)} />
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        onClick={() => supersede(fact.id)}
                        title="No longer true — keep as history"
                        className="text-[11px] text-[var(--color-text-faint)] transition-colors hover:text-[var(--color-accent)]"
                      >
                        Outdated
                      </button>
                      <button
                        onClick={() => removeFact(fact.id)}
                        aria-label="Delete"
                        className="focus-ring text-[var(--color-text-faint)] hover:text-[var(--color-danger)]"
                      >
                        <IconTrash />
                      </button>
                    </div>
                  </div>
                  {/* Candidate origins for a fact that was typed rather than
                      promoted. Proposed, never linked automatically — a wrong
                      citation is worse than a missing one. */}
                  {originFor === fact.id && (
                    <div className="mt-2 border-t border-[var(--color-border)] pt-2">
                      {originCandidates === null ? (
                        <div className="text-[12px] text-[var(--color-text-muted)]">Searching the archive…</div>
                      ) : originCandidates.length === 0 ? (
                        <div className="text-[12px] text-[var(--color-text-muted)]">
                          Nothing in the archive matches this closely enough to be its source.{" "}
                          <button onClick={() => setOriginFor(null)} className="text-[var(--color-accent)]">
                            Close
                          </button>
                        </div>
                      ) : (
                        <>
                          <div className="mb-1.5 text-[11px] text-[var(--color-text-faint)]">
                            Which message did you learn this from?
                          </div>
                          <div className="flex flex-col gap-1.5">
                            {originCandidates.map((c) => (
                              <div key={c.messageId} className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="text-[11px] text-[var(--color-text-faint)] font-technical">
                                    {c.date.slice(0, 10)} · {c.role === "user" ? "you" : "Magi"} · {c.conversationTitle}
                                  </div>
                                  <div className="text-[12px] text-[var(--color-text-muted)]">{c.preview}…</div>
                                </div>
                                <Button variant="ghost" className="shrink-0" onClick={() => linkOrigin(fact.id, c)}>
                                  This one
                                </Button>
                              </div>
                            ))}
                          </div>
                          <button
                            onClick={() => setOriginFor(null)}
                            className="mt-2 text-[11px] text-[var(--color-text-faint)] hover:text-[var(--color-accent)]"
                          >
                            None of these
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </Panel>
              ))}
            </div>
          )}

          <div className="mt-3 flex items-start gap-2">
            <Textarea
              value={newFact}
              onChange={(e) => setNewFact(e.target.value)}
              rows={2}
              placeholder="Something you know about them"
            />
            <Button variant="accent" onClick={addFact} className="mt-0.5 shrink-0">
              <IconPlus /> Add
            </Button>
          </div>
          {established.length > 0 && newFact.trim() && (
            <div className="mt-2 flex items-center gap-2">
              <span className="text-[11.5px] text-[var(--color-text-muted)]">Replaces:</span>
              <select
                value={supersedesId}
                onChange={(e) => setSupersedesId(e.target.value)}
                className="focus-ring max-w-[420px] rounded-[3px] border border-[var(--color-border-strong)] bg-[var(--color-bg)] px-2 py-1 text-[12px] text-[var(--color-text)]"
              >
                <option value="">Nothing — this is new</option>
                {established.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.content.slice(0, 70)}
                  </option>
                ))}
              </select>
            </div>
          )}

          {superseded.length > 0 && (
            <div className="mt-4">
              <button
                onClick={() => setShowSuperseded((v) => !v)}
                className="text-[11.5px] text-[var(--color-text-faint)] hover:text-[var(--color-accent)] transition-colors"
              >
                {showSuperseded ? "Hide" : "Show"} {superseded.length} no longer true
              </button>
              {showSuperseded && (
                <div className="mt-2 flex flex-col gap-1.5">
                  {superseded.map((fact) => (
                    <Panel key={fact.id} className="px-4 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <span className="text-[13px] leading-relaxed text-[var(--color-text-faint)] line-through decoration-[var(--color-border-strong)]">
                            {fact.content}
                          </span>
                          <FactOrigin fact={fact} />
                        </div>
                        <button
                          onClick={() => removeFact(fact.id)}
                          aria-label="Delete"
                          className="focus-ring shrink-0 text-[var(--color-text-faint)] hover:text-[var(--color-danger)]"
                        >
                          <IconTrash />
                        </button>
                      </div>
                    </Panel>
                  ))}
                  <p className="text-[11.5px] text-[var(--color-text-faint)]">
                    Kept as history. None of these reach a reply, the roster, or search.
                  </p>
                </div>
              )}
            </div>
          )}
        </section>

        {/* 2 — Mentions */}
        <section className="mb-9">
          <h2 className="mb-1 text-[13px] font-semibold uppercase tracking-[0.1em] text-[var(--color-text-faint)] font-technical">
            Mentions
          </h2>
          <p className="mb-2 text-[12.5px] text-[var(--color-text-muted)]">
            Passages that mention them by name. Found by searching what you have already written — nothing was extracted
            or inferred to build this.
          </p>
          {/* Most people here are recorded under a first name, which matches
              indiscriminately across unrelated Projects. Scoping to their own
              Projects removes most of that noise; the wider search stays one
              click away, with what it would find shown. */}
          {mentionMeta && mentionMeta.scopedProjectCount > 0 && (
            <div className="mb-2.5 flex flex-wrap items-center gap-2 text-[11.5px] text-[var(--color-text-faint)]">
              <span>
                {mentionMeta.fellBack
                  ? `Nothing in their ${mentionMeta.scopedProjectCount} Project${mentionMeta.scopedProjectCount === 1 ? "" : "s"} — showing the whole archive.`
                  : mentionScope === "projects"
                    ? `Searching their ${mentionMeta.scopedProjectCount} Project${mentionMeta.scopedProjectCount === 1 ? "" : "s"}.`
                    : "Searching the whole archive."}
              </span>
              {!mentionMeta.fellBack && (
                <button
                  onClick={() => setMentionScope((s) => (s === "projects" ? "everywhere" : "projects"))}
                  className="underline underline-offset-2 transition-colors hover:text-[var(--color-accent)]"
                >
                  {mentionScope === "projects"
                    ? `Search everywhere (${mentionMeta.everywhereCount} match${mentionMeta.everywhereCount === 1 ? "" : "es"})`
                    : "Back to their Projects"}
                </button>
              )}
            </div>
          )}
          {mentions === null ? (
            <div className="text-[13px] text-[var(--color-text-muted)]">Searching the archive…</div>
          ) : mentions.length === 0 ? (
            <EmptyState
              title="No mentions found"
              description="Nothing in the archive matches their name or aliases yet."
            />
          ) : (
            <div className="flex flex-col gap-1.5">
              {mentions.map((m) => (
                <Panel key={m.chunkId} className="px-4 py-3">
                  <div className="mb-1 flex items-baseline justify-between gap-3">
                    <span className="truncate text-[12.5px] font-medium text-[var(--color-text)]">
                      {m.href ? (
                        <Link href={m.href} className="hover:text-[var(--color-accent)] transition-colors">
                          {m.title}
                        </Link>
                      ) : (
                        m.title
                      )}
                    </span>
                    <span className="shrink-0 text-[11px] text-[var(--color-text-faint)] font-technical">
                      {KIND_LABEL[m.kind] ?? m.kind} · {m.date.slice(0, 10)}
                    </span>
                  </div>
                  <p className="text-[12.5px] leading-relaxed text-[var(--color-text-muted)]">
                    {link(m.content.length > 400 ? `${m.content.slice(0, 400)}…` : m.content)}
                  </p>
                  {m.context && (
                    <div className="mt-1 text-[11px] text-[var(--color-text-faint)] font-technical">{m.context}</div>
                  )}
                </Panel>
              ))}
            </div>
          )}
        </section>

        {/* 3 — Over time. Costs nothing: passages are already dated, and the
            person already has names to match on, so this is retrieval
            reorganized by time rather than a model call. */}
        <section className="mb-9">
          <div className="mb-1 flex items-baseline justify-between gap-3">
            <h2 className="text-[13px] font-semibold uppercase tracking-[0.1em] text-[var(--color-text-faint)] font-technical">
              Over time
            </h2>
            {!showTrajectory && (
              <Button variant="ghost" onClick={() => setShowTrajectory(true)}>
                Trace
              </Button>
            )}
          </div>
          <p className="mb-2.5 text-[12.5px] text-[var(--color-text-muted)]">
            How your work with them has developed, by when they were actually mentioned. The counts are every
            matching passage; the extracts under each period are the closest few.
          </p>
          {!showTrajectory ? null : trajectory === null ? (
            <div className="text-[13px] text-[var(--color-text-muted)]">Reading the archive…</div>
          ) : trajectory.totalPassages === 0 ? (
            <EmptyState
              title="Nothing to trace yet"
              description="No dated passages in the archive mention them closely enough to build a timeline."
            />
          ) : (
            <TrajectoryTimeline trajectory={trajectory} />
          )}
        </section>

        {/* 4 — Projects */}
        <section className="mb-9">
          <h2 className="mb-2.5 text-[13px] font-semibold uppercase tracking-[0.1em] text-[var(--color-text-faint)] font-technical">
            Projects
          </h2>
          {projects.length === 0 ? (
            <p className="mb-2 text-[13px] text-[var(--color-text-muted)]">Not associated with any Project yet.</p>
          ) : (
            <div className="mb-3 flex flex-col gap-1.5">
              {projects.map((p) => (
                <Panel key={p.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <Link
                    href={`/projects/${p.id}`}
                    className={`text-[13px] transition-colors hover:text-[var(--color-accent)] ${
                      p.status === "suggested" ? "text-[var(--color-text-muted)]" : "text-[var(--color-text)]"
                    }`}
                  >
                    {p.name}
                  </Link>
                  <div className="flex items-center gap-2">
                    {p.status === "suggested" && (
                      <>
                        <Tag>Proposed</Tag>
                        <Button variant="ghost" onClick={() => keepProject(p.id)}>
                          Keep
                        </Button>
                      </>
                    )}
                    <button
                      onClick={() => removeProject(p.id)}
                      aria-label="Remove from Project"
                      className="focus-ring text-[var(--color-text-faint)] hover:text-[var(--color-danger)]"
                    >
                      <IconTrash />
                    </button>
                  </div>
                </Panel>
              ))}
            </div>
          )}
          {unassigned.length > 0 && (
            <div className="flex items-center gap-2">
              <select
                value={addProjectId}
                onChange={(e) => setAddProjectId(e.target.value)}
                className="focus-ring rounded-[3px] border border-[var(--color-border-strong)] bg-[var(--color-bg)] px-2 py-1.5 text-[13px] text-[var(--color-text)]"
              >
                <option value="">Add to a Project…</option>
                {unassigned.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <Button onClick={addProject} disabled={!addProjectId}>
                Add
              </Button>
            </div>
          )}
        </section>

        {/* Merge and delete — both deliberate, both confirmed. */}
        <section className="border-t border-[var(--color-border)] pt-6">
          {mergeCandidates.length > 0 && (
            <div className="mb-5">
              <Label>Merge into another person</Label>
              <p className="mb-2 text-[12.5px] text-[var(--color-text-muted)]">
                Everything known about {person.name} moves across, and this name becomes an alias of the person you pick.
                Nothing about this is automatic — Magi never decides that two names are the same human.
              </p>
              <div className="flex items-center gap-2">
                <select
                  value={mergeId}
                  onChange={(e) => setMergeId(e.target.value)}
                  className="focus-ring rounded-[3px] border border-[var(--color-border-strong)] bg-[var(--color-bg)] px-2 py-1.5 text-[13px] text-[var(--color-text)]"
                >
                  <option value="">Choose a person…</option>
                  {mergeCandidates.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <Button onClick={merge} disabled={!mergeId}>
                  Merge
                </Button>
              </div>
            </div>
          )}

          {confirmDelete ? (
            <div className="flex items-center gap-2">
              <span className="text-[13px] text-[var(--color-text-muted)]">
                Delete {person.name}, every fact about them, and every trace of them in search? This cannot be undone.
              </span>
              <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
                Cancel
              </Button>
              <Button variant="danger" onClick={remove}>
                Delete
              </Button>
            </div>
          ) : (
            <Button variant="danger" onClick={() => setConfirmDelete(true)}>
              <IconTrash /> Delete this person
            </Button>
          )}
        </section>
      </div>
    </div>
  );
}

// When a fact was learned and, where it came from a conversation, a link back
// to the exact message. The same treatment the Memory page gives a claim.
function FactOrigin({ fact, onFindOrigin }: { fact: Fact; onFindOrigin?: () => void }) {
  return (
    <div className="mt-1 text-[11px] text-[var(--color-text-faint)] font-technical">
      {fact.created_at.slice(0, 10)}
      {fact.sourceLink ? (
        <>
          {" · "}
          <Link
            href={fact.sourceLink.href}
            className="underline decoration-[var(--color-border-strong)] underline-offset-2 transition-colors hover:text-[var(--color-accent)] hover:decoration-[var(--color-accent)]"
          >
            {fact.source_message_id ? "from this message" : "from this conversation"}
            {fact.sourceLink.context ? ` in ${fact.sourceLink.context}` : ""}
          </Link>
        </>
      ) : (
        onFindOrigin && (
          <>
            {" · "}
            <button onClick={onFindOrigin} className="underline underline-offset-2 hover:text-[var(--color-accent)]">
              find where I learned this
            </button>
          </>
        )
      )}
    </div>
  );
}
