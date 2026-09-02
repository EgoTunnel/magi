"use client";

import Link from "next/link";

// Retrieval reorganized by time, rendered. Extracted from the Archive page so
// the person page can show the same thing for a person's name rather than a
// topic — one component, so the two can never drift into disagreeing about
// what a timeline looks like or what its caveats are.

export interface TimelinePassage {
  chunkId: string;
  kind: string;
  title: string;
  date: string;
  preview: string;
  similarity?: number;
  href?: string;
  sourceContext?: string;
}
export interface TimelinePeriod {
  key: string;
  label: string;
  count: number;
  passages: TimelinePassage[];
}
export interface TimelineTrajectory {
  query: string;
  granularity: "month" | "quarter";
  totalPassages: number;
  firstDate: string | null;
  lastDate: string | null;
  spanDays: number;
  periods: TimelinePeriod[];
}

export const KIND_LABEL: Record<string, string> = {
  project: "Project",
  conversation: "Conversation",
  message: "Message",
  memory: "Memory",
  document: "Document",
  artifact: "Artifact",
  skill: "Skill",
  style_guide: "Style Guide",
  character: "Character",
  person: "Person",
};

// How often the topic came up in each period. One series, so no legend — the
// heading names it; magnitude over ordered time, so columns rather than a line
// (the periods are counts in buckets, not a continuous measurement). The
// period list rendered below this doubles as the chart's table view, so the
// shape is never the only way to read the numbers.
export function TimelineChart({ periods }: { periods: { key: string; label: string; count: number }[] }) {
  if (periods.length < 2) return null;
  const max = Math.max(...periods.map((p) => p.count));
  const peak = periods.findIndex((p) => p.count === max);

  return (
    <div>
      <div
        className="flex h-14 items-end gap-[2px]"
        role="img"
        aria-label={`Passages per period, peaking at ${max} in ${periods[peak].label}`}
      >
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

export function TrajectoryTimeline({ trajectory }: { trajectory: TimelineTrajectory }) {
  return (
    <div>
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
              {/* Counts are uncapped; the passages are a relevance-ranked
                  sample, so a quiet period can be real and still have nothing
                  strong enough to show. Say that rather than rendering an
                  empty period. */}
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
  );
}
