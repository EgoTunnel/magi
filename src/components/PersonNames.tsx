"use client";

import { Fragment, type ReactNode } from "react";
import Link from "next/link";

export interface NamedPerson {
  id: string;
  name: string;
  aliases?: string[];
}

// Facts and summaries already refer to each other by name — Dionne was
// introduced by Annette, Szidonia works with Krystina. Rendering those names as
// links costs nothing and makes the rolodex read as a place rather than a list.
//
// Exact matches only, on word boundaries, using the same names the rest of the
// feature matches on. This is emphatically not a relationship graph: nothing is
// stored, nothing is inferred, and a name that happens to appear is a link, not
// a claim that the two people are connected.
export function linkPersonNames(text: string, people: NamedPerson[], excludeId?: string): ReactNode {
  const entries = people
    .filter((p) => p.id !== excludeId)
    .flatMap((p) => [p.name, ...(p.aliases ?? [])].map((name) => ({ id: p.id, name })))
    .filter((e) => e.name.trim().length > 2)
    // Longest first, so "Annette Palalas" wins over "Annette" and the link
    // covers the whole name rather than half of it.
    .sort((a, b) => b.name.length - a.name.length);
  if (!entries.length) return text;

  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}])(${entries.map((e) => e.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?![\\p{L}\\p{N}])`,
    "giu"
  );

  const out: ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    const hit = entries.find((e) => e.name.toLowerCase() === match![1].toLowerCase());
    if (!hit) continue;
    if (match.index > last) out.push(text.slice(last, match.index));
    out.push(
      <Link
        key={`${hit.id}-${match.index}`}
        href={`/people/${hit.id}`}
        className="underline decoration-[var(--color-border-strong)] underline-offset-2 transition-colors hover:text-[var(--color-accent)] hover:decoration-[var(--color-accent)]"
      >
        {match[1]}
      </Link>
    );
    last = match.index + match[1].length;
  }
  if (!out.length) return text;
  if (last < text.length) out.push(text.slice(last));
  return out.map((node, i) => <Fragment key={i}>{node}</Fragment>);
}
