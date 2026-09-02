import { ensureChunkIndex, matchCountsByDate, retrieveChunks, type RetrievedChunk } from "@/lib/retrieval";
import { resolveSourceLinks, type SourceLink } from "@/lib/sourceLinks";
import type { SearchKind } from "@/lib/searchIndex";

// "When did I first think about this?" and "how has my thinking changed?" are
// the questions a personal archive is uniquely able to answer and a chat
// product cannot. Every passage carries a source_date (see the sourceDate
// threading in searchIndex.ts), so this is relevance retrieval reorganized by
// time rather than by score.
//
// The one thing that must not be done naively: taking the top N passages by
// relevance and sorting them by date. Relevance clusters — the best matches
// almost always come from whenever the topic was hottest — so the result would
// be a timeline of one month, presented as if it were a history. Instead a
// large pool is retrieved, bucketed into periods, and the most relevant few
// kept *within each period*, which guarantees coverage across the whole span.

// Large enough that a topic spread over a year still has candidates in its
// quiet periods, small enough to stay a fast local operation.
const POOL_SIZE = 240;
const PASSAGES_PER_PERIOD = 3;
// Above this many months, months become quarters — a timeline with 30 rows
// isn't a shape anyone can read.
const MAX_PERIODS = 14;

export interface TrajectoryPassage {
  chunkId: string;
  kind: SearchKind;
  refId: string;
  title: string;
  date: string;
  preview: string;
  similarity?: number;
  matchedBy: RetrievedChunk["matchedBy"];
  href?: string;
  sourceContext?: string;
}

export interface TrajectoryPeriod {
  key: string;
  label: string;
  // Every matching passage in this period — an uncapped count, not a count of
  // the retrieval pool. This is what makes the shape of the timeline honest;
  // the passages below it are a relevance-ranked sample of the same set.
  count: number;
  passages: TrajectoryPassage[];
}

export interface Trajectory {
  query: string;
  granularity: "month" | "quarter";
  totalPassages: number;
  // The true first and last dates the topic appears, from the uncapped count —
  // "when did I first think about this" has to be the real first, not the
  // earliest thing that happened to survive a relevance cutoff.
  firstDate: string | null;
  lastDate: string | null;
  // Representative passages at each end, when the sample reached them.
  first: TrajectoryPassage | null;
  last: TrajectoryPassage | null;
  spanDays: number;
  periods: TrajectoryPeriod[];
}

function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

function quarterKey(iso: string): string {
  const month = Number(iso.slice(5, 7));
  return `${iso.slice(0, 4)}-Q${Math.floor((month - 1) / 3) + 1}`;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function label(key: string): string {
  if (key.includes("Q")) return `${key.slice(5)} ${key.slice(0, 4)}`;
  const month = Number(key.slice(5, 7));
  return `${MONTH_NAMES[month - 1] ?? key} ${key.slice(0, 4)}`;
}

function toPassage(chunk: RetrievedChunk, link: SourceLink | undefined): TrajectoryPassage {
  return {
    chunkId: chunk.chunkId,
    kind: chunk.kind,
    refId: chunk.refId,
    title: chunk.title,
    date: chunk.sourceDate,
    preview: chunk.content.replace(/\s+/g, " ").slice(0, 240),
    similarity: chunk.similarity,
    matchedBy: chunk.matchedBy,
    href: link?.href,
    sourceContext: link?.context || undefined,
  };
}

export async function traceTrajectory(
  query: string,
  opts: { projectId?: string | string[]; kinds?: SearchKind[] } = {}
): Promise<Trajectory> {
  ensureChunkIndex();

  // Counts and endpoints come from an uncapped query; passages come from a
  // relevance-ranked pool. Keeping the two separate is the whole difference
  // between a timeline and a picture of a retrieval cap.
  const counts = matchCountsByDate(query, opts);

  const pool = await retrieveChunks(query, {
    ...opts,
    limit: POOL_SIZE,
    // A topic someone returned to across a year lives in a handful of long
    // conversations; the ordinary three-per-source cap would erase exactly the
    // repetition being asked about.
    maxPerSource: 12,
  });

  const dated = pool
    .filter((c) => /^\d{4}-\d{2}/.test(c.sourceDate))
    .sort((a, b) => (a.sourceDate < b.sourceDate ? -1 : a.sourceDate > b.sourceDate ? 1 : 0));

  if (!dated.length && !counts.total) {
    return {
      query,
      granularity: "month",
      totalPassages: 0,
      firstDate: null,
      lastDate: null,
      first: null,
      last: null,
      spanDays: 0,
      periods: [],
    };
  }

  const links = resolveSourceLinks(dated.map((c) => ({ kind: c.kind, refId: c.refId })));
  const linkFor = (c: RetrievedChunk) => links.get(`${c.kind}:${c.refId}`);

  // Granularity is chosen from how many distinct months actually matched, so a
  // topic confined to one season stays month-by-month while one spanning years
  // collapses to quarters.
  const distinctMonths = new Set([
    ...counts.byMonth.keys(),
    ...dated.map((c) => monthKey(c.sourceDate)),
  ]).size;
  const granularity: "month" | "quarter" = distinctMonths > MAX_PERIODS ? "quarter" : "month";
  const keyOf = granularity === "quarter" ? quarterKey : monthKey;

  // Counts drive which periods exist and how tall each is; the pool only
  // supplies illustrations. A period with matches but no sampled passage is
  // still a real period and still gets a bar.
  const periodCounts = new Map<string, number>();
  for (const [month, n] of counts.byMonth) {
    const key = granularity === "quarter" ? quarterKey(`${month}-01`) : month;
    periodCounts.set(key, (periodCounts.get(key) ?? 0) + n);
  }

  const buckets = new Map<string, RetrievedChunk[]>();
  for (const chunk of dated) {
    const key = keyOf(chunk.sourceDate);
    const list = buckets.get(key);
    if (list) list.push(chunk);
    else buckets.set(key, [chunk]);
    if (!periodCounts.has(key)) periodCounts.set(key, 0);
  }

  const periods: TrajectoryPeriod[] = [...periodCounts.keys()]
    .sort((a, b) => (a < b ? -1 : 1))
    .map((key) => {
      const chunks = buckets.get(key) ?? [];
      return {
        key,
        label: label(key),
        // Semantic-only matches don't appear in the keyword count, so a period
        // never claims fewer passages than it is actually showing.
        count: Math.max(periodCounts.get(key) ?? 0, chunks.length),
        passages: chunks
          // Most relevant within the period — the point is what best represents
          // this moment in the topic's life, not what happened to come first.
          .slice()
          .sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0))
          .slice(0, PASSAGES_PER_PERIOD)
          .map((c) => toPassage(c, linkFor(c))),
      };
    });

  const firstDate = [counts.earliest, dated[0]?.sourceDate].filter(Boolean).sort()[0] ?? null;
  const lastDate =
    [counts.latest, dated[dated.length - 1]?.sourceDate].filter(Boolean).sort().reverse()[0] ?? null;
  const spanDays =
    firstDate && lastDate
      ? Math.round((new Date(lastDate).getTime() - new Date(firstDate).getTime()) / 86_400_000)
      : 0;

  return {
    query,
    granularity,
    totalPassages: Math.max(counts.total, dated.length),
    firstDate,
    lastDate,
    first: dated.length ? toPassage(dated[0], linkFor(dated[0])) : null,
    last: dated.length ? toPassage(dated[dated.length - 1], linkFor(dated[dated.length - 1])) : null,
    spanDays: Number.isFinite(spanDays) ? spanDays : 0,
    periods: periods.filter((p) => p.count > 0),
  };
}

// The material a narration model is given: earliest and latest periods in
// full, plus a thinned middle, so "what changed" has both ends to compare
// without paying for every passage in between.
export function trajectoryDigest(trajectory: Trajectory): string {
  return trajectory.periods
    .map((p) => {
      const lines = p.passages.map((x) => `- (${x.date.slice(0, 10)}, ${x.kind}) ${x.title}: ${x.preview}`);
      return `## ${p.label} — ${p.count} passage${p.count === 1 ? "" : "s"}\n${lines.join("\n")}`;
    })
    .join("\n\n");
}
