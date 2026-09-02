"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button, EmptyState, Input, Tag } from "@/components/ui";
import { IconSearch } from "@/components/icons";
import { renderMarkdown } from "@/lib/markdownToReact";

interface SearchResult {
  kind: string;
  refId: string;
  projectId: string | null;
  title: string;
  snippet: string;
  createdAt: string;
  similarity?: number;
}

function highlightSnippet(snippet: string): string {
  const escaped = snippet.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return escaped.replace(/⟦/g, "<mark>").replace(/⟧/g, "</mark>");
}

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
    case "style_guide":
    case "character":
      return r.projectId ? `/image-lab?project=${r.projectId}` : "/image-lab";
    default:
      return r.projectId ? `/projects/${r.projectId}` : "/archive";
  }
}

interface TrajectoryPassage {
  chunkId: string;
  kind: string;
  title: string;
  date: string;
  preview: string;
  similarity?: number;
  href?: string;
  sourceContext?: string;
}
interface Trajectory {
  query: string;
  granularity: "month" | "quarter";
  totalPassages: number;
  firstDate: string | null;
  lastDate: string | null;
  first: TrajectoryPassage | null;
  last: TrajectoryPassage | null;
  spanDays: number;
  periods: { key: string; label: string; count: number; passages: TrajectoryPassage[] }[];
}

// How often the topic came up in each period. One series, so no legend — the
// heading names it; magnitude over ordered time, so columns rather than a line
// (the periods are counts in buckets, not a continuous measurement). The
// period list rendered below this doubles as the chart's table view, so the
// shape is never the only way to read the numbers.
function TimelineChart({ periods }: { periods: { key: string; label: string; count: number }[] }) {
  if (periods.length < 2) return null;
  const max = Math.max(...periods.map((p) => p.count));
  const peak = periods.findIndex((p) => p.count === max);

  return (
    <div>
      <div className="flex h-14 items-end gap-[2px]" role="img" aria-label={`Passages per period, peaking at ${max} in ${periods[peak].label}`}>
        {periods.map((p, i) => (
          <div
            key={p.key}
            title={`${p.label}: ${p.count} passage${p.count === 1 ? "" : "s"}`}
            className="group relative flex-1 rounded-t-[4px] bg-[var(--color-accent)] opacity-70 transition-opacity hover:opacity-100"
            style={{ height: `${Math.max(6, (p.count / max) * 100)}%` }}
          >
            <span className="pointer-events-none absolute -top-4 left-1/2 hidden -translate-x-1/2 whitespace-nowrap font-technical text-[10px] text-[var(--color-text)] group-hover:block">
              {p.count}
            </span>
            {/* Selective direct labels only: the peak carries a number at rest,
                every other bar reveals its own on hover. */}
            {i === peak && (
              <span className="pointer-events-none absolute -top-4 left-1/2 -translate-x-1/2 whitespace-nowrap font-technical text-[10px] text-[var(--color-text-muted)] group-hover:hidden">
                {p.count}
              </span>
            )}
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between font-technical text-[10px] text-[var(--color-text-faint)]">
        <span>{periods[0].label}</span>
        <span>{periods[periods.length - 1].label}</span>
      </div>
    </div>
  );
}

export function ArchiveClient() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [mode, setMode] = useState<"search" | "ask" | "trajectory">("search");
  const [searchStyle, setSearchStyle] = useState<"wording" | "meaning">("wording");
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [answerSources, setAnswerSources] = useState<SearchResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [trajectory, setTrajectory] = useState<Trajectory | null>(null);
  const [narration, setNarration] = useState<string | null>(null);
  const [tracing, setTracing] = useState(false);
  const [narrating, setNarrating] = useState(false);

  useEffect(() => {
    if (mode !== "search" || !query.trim()) {
      if (mode === "search") {
        setResults([]);
        setSearchError(null);
      }
      return;
    }
    const handle = setTimeout(async () => {
      const endpoint = searchStyle === "meaning" ? "/api/search/semantic" : "/api/search";
      const res = await fetch(`${endpoint}?q=${encodeURIComponent(query)}`);
      if (res.status === 412) {
        const data = await res.json();
        setSearchError(data.message);
        setResults([]);
        return;
      }
      setSearchError(null);
      const data = await res.json();
      setResults(data.results ?? []);
    }, 150);
    return () => clearTimeout(handle);
  }, [query, mode, searchStyle]);

  // The timeline itself costs nothing — it's retrieval reorganized by date —
  // so it runs on its own. Narration is a separate button because it's the
  // only part that spends anything.
  async function trace(narrate: boolean) {
    if (!query.trim()) return;
    if (narrate) setNarrating(true);
    else {
      setTracing(true);
      setNarration(null);
    }
    setError(null);
    const res = await fetch("/api/archive/trajectory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, narrate }),
    });
    const data = await res.json();
    setTrajectory(data.trajectory ?? null);
    if (data.narration) setNarration(data.narration);
    if (data.error === "NO_API_KEY") setError(data.message);
    setTracing(false);
    setNarrating(false);
  }

  async function ask() {
    if (!query.trim()) return;
    setAsking(true);
    setError(null);
    setAnswer(null);
    const res = await fetch("/api/archive/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: query }),
    });
    if (res.status === 412) {
      const data = await res.json();
      setError(data.message);
      setAsking(false);
      return;
    }
    const data = await res.json();
    setAnswer(data.answer);
    setAnswerSources(data.sources ?? []);
    setAsking(false);
  }

  return (
    <div className="mx-auto max-w-2xl px-8 py-8">
      <div className="mb-4 flex items-center gap-2">
        <div className="relative flex-1">
          <IconSearch className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-faint)]" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              if (mode === "ask") ask();
              if (mode === "trajectory") trace(false);
            }}
            placeholder={
              mode === "search"
                ? "Search by meaning or wording…"
                : mode === "ask"
                  ? "Ask a question about your archive…"
                  : "A topic to trace over time…"
            }
            className="pl-8"
          />
        </div>
        <div className="flex rounded-[3px] border border-[var(--color-border-strong)] overflow-hidden">
          {(["search", "ask", "trajectory"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-3 py-1.5 text-[12px] transition-colors ${mode === m ? "bg-[var(--color-accent)] text-[var(--color-accent-contrast)]" : "text-[var(--color-text-muted)] hover:bg-[var(--color-surface)]"}`}
            >
              {m === "search" ? "Search" : m === "ask" ? "Ask" : "Over time"}
            </button>
          ))}
        </div>
      </div>

      {mode === "trajectory" && (
        <div className="mb-6">
          <div className="flex items-center gap-2">
            <Button variant="accent" onClick={() => trace(false)} disabled={!query.trim() || tracing}>
              {tracing ? "Tracing…" : "Trace this topic"}
            </Button>
            {trajectory && trajectory.totalPassages > 0 && !narration && (
              <Button variant="ghost" onClick={() => trace(true)} disabled={narrating}>
                {narrating ? "Reading the timeline…" : "Describe how it changed"}
              </Button>
            )}
          </div>
          <p className="mt-2 text-[12px] leading-relaxed text-[var(--color-text-muted)]">
            When a topic first appears in your archive, how often it came up since, and what you were
            saying about it at each point. The timeline itself is free; only describing the change calls a
            model.
          </p>

          {error && (
            <div className="mt-3 rounded-[4px] border border-[var(--color-accent)] bg-[var(--color-surface)] px-4 py-3 text-[13px] text-[var(--color-text)]">
              {error}{" "}
              <Link href="/settings" className="text-[var(--color-accent)] underline">
                Open Settings
              </Link>
            </div>
          )}

          {narration && (
            <div className="mt-4 rounded-[4px] border border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-4">
              <div className="prose-magi text-[15px]">{renderMarkdown(narration)}</div>
            </div>
          )}

          {trajectory && trajectory.totalPassages === 0 && (
            <div className="mt-4">
              <EmptyState title="Nothing on this topic yet" description="No passages in the archive match it closely enough to trace." />
            </div>
          )}

          {trajectory && trajectory.totalPassages > 0 && (
            <div className="mt-5">
              <div className="mb-4 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[12.5px] text-[var(--color-text-muted)]">
                <span>
                  <span className="text-[var(--color-text)]">{trajectory.totalPassages}</span> passages
                </span>
                <span>
                  first on <span className="text-[var(--color-text)]">{trajectory.firstDate?.slice(0, 10)}</span>
                </span>
                <span>
                  most recent <span className="text-[var(--color-text)]">{trajectory.lastDate?.slice(0, 10)}</span>
                </span>
                <span>
                  spanning <span className="text-[var(--color-text)]">{trajectory.spanDays}</span> days
                </span>
              </div>
              <TimelineChart periods={trajectory.periods} />
              <div className="mt-5 flex flex-col gap-5">
                {trajectory.periods.map((p) => (
                  <div key={p.key}>
                    <div className="mb-1.5 flex items-baseline gap-2">
                      <span className="text-[13px] font-medium text-[var(--color-text)]">{p.label}</span>
                      <span className="font-technical text-[11px] text-[var(--color-text-faint)]">
                        {p.count} passage{p.count === 1 ? "" : "s"}
                      </span>
                    </div>
                    <div className="flex flex-col gap-1.5 border-l border-[var(--color-border)] pl-3">
                      {/* Counts are uncapped; the passages are a
                          relevance-ranked sample, so a quiet period can be real
                          and still have nothing strong enough to show. Say that
                          rather than rendering an empty period. */}
                      {p.passages.length === 0 && (
                        <p className="text-[12px] text-[var(--color-text-faint)]">
                          Mentioned here, but nothing among the closest matches.
                        </p>
                      )}
                      {p.passages.map((x) => (
                        <div key={x.chunkId}>
                          <div className="flex items-baseline gap-2">
                            <span className="font-technical text-[10.5px] uppercase tracking-[0.06em] text-[var(--color-text-faint)]">
                              {x.date.slice(0, 10)} · {KIND_LABEL[x.kind] ?? x.kind}
                            </span>
                            {x.href ? (
                              <Link
                                href={x.href}
                                className="truncate text-[12.5px] text-[var(--color-text)] underline decoration-[var(--color-border-strong)] underline-offset-2 transition-colors hover:text-[var(--color-accent)]"
                              >
                                {x.title}
                              </Link>
                            ) : (
                              <span className="truncate text-[12.5px] text-[var(--color-text)]">{x.title}</span>
                            )}
                          </div>
                          <p className="text-[12px] leading-relaxed text-[var(--color-text-muted)]">{x.preview}…</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {mode === "ask" && (
        <div className="mb-6">
          <Button variant="accent" onClick={ask} disabled={!query.trim() || asking}>
            {asking ? "Consulting the archive…" : "Ask my archive"}
          </Button>
          {error && (
            <div className="mt-3 rounded-[4px] border border-[var(--color-accent)] bg-[var(--color-surface)] px-4 py-3 text-[13px] text-[var(--color-text)]">
              {error}{" "}
              <Link href="/settings" className="text-[var(--color-accent)] underline">
                Open Settings
              </Link>
            </div>
          )}
          {answer && (
            <div className="mt-4 rounded-[4px] border border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-4">
              <div className="prose-magi text-[15px]">
                {renderMarkdown(answer)}
              </div>
              {answerSources.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-1.5 border-t border-[var(--color-border)] pt-3">
                  {answerSources.map((s, i) => (
                    <Link key={i} href={hrefFor(s)} className="text-[11px] text-[var(--color-text-faint)] hover:text-[var(--color-accent)] transition-colors">
                      [{i + 1}] {s.title}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {mode === "search" && (
        <>
          <div className="mb-4 flex items-center gap-1.5 text-[12px]">
            <span className="text-[var(--color-text-faint)]">Match</span>
            <button
              onClick={() => setSearchStyle("wording")}
              className={`rounded-[3px] px-2 py-1 transition-colors ${searchStyle === "wording" ? "bg-[var(--color-surface-2)] text-[var(--color-text)]" : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"}`}
            >
              Wording
            </button>
            <button
              onClick={() => setSearchStyle("meaning")}
              className={`rounded-[3px] px-2 py-1 transition-colors ${searchStyle === "meaning" ? "bg-[var(--color-surface-2)] text-[var(--color-text)]" : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"}`}
            >
              Meaning
            </button>
          </div>

          {searchError && (
            <div className="mb-4 rounded-[4px] border border-[var(--color-accent)] bg-[var(--color-surface)] px-4 py-3 text-[13px] text-[var(--color-text)]">
              {searchError}{" "}
              <Link href="/settings" className="text-[var(--color-accent)] underline">
                Open Settings
              </Link>
            </div>
          )}

          {!searchError && query.trim() && results.length === 0 && (
            <EmptyState title="No matches" description={searchStyle === "meaning" ? "Nothing close enough in meaning yet." : "Try different wording."} />
          )}
          <div className="flex flex-col gap-1.5">
            {results.map((r, i) => (
              <Link key={i} href={hrefFor(r)}>
                <div className="rounded-[4px] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 transition-colors hover:border-[var(--color-border-strong)]">
                  <div className="mb-1 flex items-center gap-2">
                    <Tag tone="accent">{KIND_LABEL[r.kind] ?? r.kind}</Tag>
                    <span className="truncate text-[13.5px] text-[var(--color-text)]">{r.title}</span>
                    {r.similarity !== undefined && (
                      <span className="ml-auto shrink-0 text-[11px] text-[var(--color-text-faint)] font-technical">
                        {Math.round(r.similarity * 100)}% match
                      </span>
                    )}
                  </div>
                  <div
                    className="truncate text-[12.5px] text-[var(--color-text-muted)]"
                    dangerouslySetInnerHTML={{ __html: highlightSnippet(r.snippet) }}
                  />
                </div>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
