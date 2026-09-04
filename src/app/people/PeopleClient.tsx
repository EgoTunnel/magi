"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button, EmptyState, Input, Label, Panel, Tag, Textarea } from "@/components/ui";
import { IconPlus, IconTrash } from "@/components/icons";

interface Person {
  id: string;
  name: string;
  aliases: string[];
  relationship: string | null;
  summary: string | null;
  status: "established" | "suggested";
  created_at: string;
}

export function PeopleClient() {
  const [people, setPeople] = useState<Person[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState("");
  const [relationship, setRelationship] = useState("");
  const [summary, setSummary] = useState("");
  const [aliases, setAliases] = useState("");
  const [filter, setFilter] = useState("");

  async function load() {
    const res = await fetch("/api/people");
    setPeople((await res.json()).people);
  }

  useEffect(() => {
    load();
  }, []);

  async function create() {
    if (!name.trim()) return;
    await fetch("/api/people", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        relationship: relationship.trim() || null,
        summary: summary.trim() || null,
        aliases: parseAliases(aliases),
      }),
    });
    setName("");
    setRelationship("");
    setSummary("");
    setAliases("");
    setFormOpen(false);
    load();
  }

  async function keep(id: string) {
    await fetch(`/api/people/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "established" }),
    });
    load();
  }

  async function discard(id: string) {
    await fetch(`/api/people/${id}`, { method: "DELETE" });
    load();
  }

  const suggested = people.filter((p) => p.status === "suggested");
  const established = people.filter((p) => p.status !== "suggested");
  const needle = filter.trim().toLowerCase();
  const shown = needle
    ? established.filter((p) =>
        [p.name, p.relationship ?? "", p.summary ?? "", ...p.aliases].join(" ").toLowerCase().includes(needle)
      )
    : established;

  return (
    <div className="mx-auto max-w-3xl px-8 py-8">
      <div className="mb-5 flex items-center justify-between gap-3">
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by name, relationship, or what you know"
          className="max-w-sm"
        />
        <Button variant="accent" onClick={() => setFormOpen((v) => !v)}>
          <IconPlus /> Add person
        </Button>
      </div>

      {formOpen && (
        <Panel className="mb-6 px-5 py-5">
          <Label>Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="How you refer to them" />
          <div className="mt-3">
            <Label>Relationship</Label>
            <Input
              value={relationship}
              onChange={(e) => setRelationship(e.target.value)}
              placeholder="colleague at Acme · client · collaborator"
            />
          </div>
          <div className="mt-3">
            <Label>Summary</Label>
            <Textarea
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              rows={2}
              placeholder="One line — who they are in relation to your work"
            />
          </div>
          <div className="mt-3">
            <Label>Also known as</Label>
            <Input
              value={aliases}
              onChange={(e) => setAliases(e.target.value)}
              placeholder="Exact alternate names, comma-separated"
            />
            <p className="mt-1 text-[11.5px] text-[var(--color-text-muted)]">
              Matching is never fuzzy. A name only refers to this person if it is written here exactly.
            </p>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setFormOpen(false)}>
              Cancel
            </Button>
            <Button variant="accent" onClick={create}>
              Save
            </Button>
          </div>
        </Panel>
      )}

      {suggested.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-1 text-[13px] font-semibold uppercase tracking-[0.1em] text-[var(--color-text-faint)] font-technical">
            Suggested
          </h2>
          <p className="mb-2.5 text-[12.5px] text-[var(--color-text-muted)]">
            Proposed by closing a conversation. Nothing here is used in a reply, or counted as known, until you keep it.
          </p>
          <div className="flex flex-col gap-1.5">
            {suggested.map((person) => (
              <Panel key={person.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link
                      href={`/people/${person.id}`}
                      className="text-[13.5px] font-medium text-[var(--color-text-muted)] hover:text-[var(--color-accent)] transition-colors"
                    >
                      {person.name}
                    </Link>
                    {person.relationship && (
                      <div className="text-[12.5px] text-[var(--color-text-faint)]">{person.relationship}</div>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button variant="ghost" onClick={() => keep(person.id)}>
                      Keep
                    </Button>
                    <button
                      onClick={() => discard(person.id)}
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
        </section>
      )}

      {shown.length === 0 ? (
        <EmptyState
          title={established.length === 0 ? "Nobody here yet" : "No match"}
          description={
            established.length === 0
              ? "Add someone you work with. Their page collects what you know about them and finds every mention of them already in your archive."
              : "No one matches that filter."
          }
        />
      ) : (
        <div className="flex flex-col gap-1.5">
          {shown.map((person) => (
            <Panel key={person.id} className="px-4 py-3">
              <Link href={`/people/${person.id}`} className="focus-ring group block">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[14px] font-medium text-[var(--color-text)] group-hover:text-[var(--color-accent)] transition-colors">
                    {person.name}
                  </span>
                  {person.relationship && <Tag>{person.relationship}</Tag>}
                </div>
                {person.summary && (
                  // Plain text, not linkPersonNames: this whole card is
                  // already an <a> to this person, and nesting an <a> for a
                  // named-mention inside it is invalid HTML (and would just
                  // navigate to the outer link's target anyway).
                  <p className="mt-1 text-[13px] leading-relaxed text-[var(--color-text-muted)]">{person.summary}</p>
                )}
                {person.aliases.length > 0 && (
                  <div className="mt-1 text-[11px] text-[var(--color-text-faint)] font-technical">
                    also: {person.aliases.join(", ")}
                  </div>
                )}
              </Link>
            </Panel>
          ))}
        </div>
      )}
    </div>
  );
}

export function parseAliases(value: string): string[] {
  return [...new Set(value.split(",").map((a) => a.trim()).filter(Boolean))];
}
