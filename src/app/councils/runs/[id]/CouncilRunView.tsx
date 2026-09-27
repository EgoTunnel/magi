"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button, Panel, Tag, Textarea } from "@/components/ui";
import { renderMarkdown } from "@/lib/markdownToReact";
import { CouncilSpinner } from "@/components/CouncilSpinner";

interface ToolCall {
  name: string;
  input: unknown;
  result: string;
}
interface CouncilTranscriptEntry {
  stage: string;
  role: string;
  modelId: string;
  content: string;
  toolCalls?: ToolCall[];
}
interface RunAttachment {
  filename: string;
  extractedText: string;
}
const CONSENSUS_LEVELS = ["None", "Weak", "Moderate", "Strong"] as const;
interface ConsensusDetail {
  source: "jev" | "synthesizer";
  level: string | null;
  confidence?: number;
  probabilities?: Record<string, number>;
  synthesizerSaid: string | null;
}
interface MatrixCell {
  option: string;
  criterion: string;
  label: string;
  level: number;
  expected: number;
  confidence?: number;
  probabilities?: Record<string, number>;
}
interface MatrixResult {
  options: string[];
  criteria: Array<{ name: string; weight: number }>;
  scoredBy?: "jev" | "model";
  cells?: MatrixCell[];
  totals?: Array<{ option: string; score: number }>;
  decisiveCriteria?: string[];
}
interface CouncilRun {
  id: string;
  question: string;
  mode: string;
  status: "running" | "complete" | "error";
  attachments: RunAttachment[];
  transcript: CouncilTranscriptEntry[];
  consensus: string | null;
  consensus_detail: ConsensusDetail | null;
  matrix: MatrixResult | null;
  disagreement: string | null;
  synthesis: string | null;
}

// Below this, a rating is shown as uncertain — marked with "?" and faded, not
// only by its tone, so it reads the same without color.
const UNSURE = 0.5;
const pct = (p: number) => `${Math.round(p * 100)}%`;

// A 0-10 value as a thin bar on a track of the same hue: magnitude only, one
// series, so one color and no legend.
function Meter({ value, label }: { value: number; label: string }) {
  return (
    <div
      className="h-1.5 w-full overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--color-accent)_16%,transparent)]"
      role="img"
      aria-label={label}
    >
      <div className="h-full rounded-full bg-[var(--color-accent)]" style={{ width: `${Math.max(0, Math.min(10, value)) * 10}%` }} />
    </div>
  );
}

function cellTitle(cell: MatrixCell): string {
  const parts = [`${cell.option} — ${cell.criterion}: ${cell.label}`];
  if (cell.confidence !== undefined) parts.push(`${pct(cell.confidence)} confident`);
  const dist = Object.entries(cell.probabilities ?? {})
    .filter(([, p]) => p >= 0.05)
    .sort((a, b) => b[1] - a[1])
    .map(([l, p]) => `${l} ${pct(p)}`);
  if (dist.length > 1) parts.push(dist.join(", "));
  return parts.join(" · ");
}

function MatrixPanel({ matrix }: { matrix: MatrixResult }) {
  if (!matrix.cells || !matrix.totals) return null;
  const cellFor = (option: string, criterion: string) =>
    matrix.cells!.find((c) => c.option === option && c.criterion === criterion);
  return (
    <Panel className="mb-8 px-5 py-5">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-[var(--color-text-faint)] font-technical">
          Decision matrix
        </span>
        <Tag>{matrix.scoredBy === "jev" ? "Scored by Jev" : "Scored by the Synthesizer model"}</Tag>
      </div>
      <div className="-mx-1 overflow-x-auto">
        <table className="w-full min-w-[480px] border-separate border-spacing-x-1 border-spacing-y-1 text-[12.5px]">
          <thead>
            <tr className="text-left text-[11px] text-[var(--color-text-faint)] font-technical">
              <th className="px-1 pb-1 font-medium">Option</th>
              {matrix.criteria.map((c) => (
                <th key={c.name} className="px-1 pb-1 font-medium">
                  {c.name}
                  <span className="ml-1 text-[var(--color-text-faint)]">×{c.weight}</span>
                </th>
              ))}
              <th className="px-1 pb-1 text-right font-medium">Weighted /10</th>
            </tr>
          </thead>
          <tbody>
            {matrix.totals.map((t, rank) => (
              <tr key={t.option}>
                <td className="px-1 py-1.5 align-top">
                  <span className={rank === 0 ? "font-semibold text-[var(--color-text)]" : "text-[var(--color-text)]"}>
                    {t.option}
                  </span>
                </td>
                {matrix.criteria.map((c) => {
                  const cell = cellFor(t.option, c.name);
                  if (!cell) return <td key={c.name} className="px-1 py-1.5 text-[var(--color-text-faint)]">—</td>;
                  const unsure = cell.confidence !== undefined && cell.confidence < UNSURE;
                  return (
                    <td key={c.name} className="px-1 py-1.5 align-top" title={cellTitle(cell)}>
                      <div className={unsure ? "opacity-60" : ""}>
                        <div className="mb-1 text-[var(--color-text-muted)]">
                          {cell.label}
                          {unsure && <span className="ml-0.5 text-[var(--color-text-faint)]">?</span>}
                        </div>
                        <Meter value={cell.expected} label={cellTitle(cell)} />
                      </div>
                    </td>
                  );
                })}
                <td className="w-28 px-1 py-1.5 align-top">
                  <div className="mb-1 text-right font-technical text-[var(--color-text)]">{t.score.toFixed(1)}</div>
                  <Meter value={t.score} label={`${t.option}: ${t.score.toFixed(1)} of 10`} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex flex-col gap-1 text-[12px] leading-relaxed text-[var(--color-text-muted)]">
        {matrix.decisiveCriteria && matrix.decisiveCriteria.length > 0 ? (
          <p>
            The ranking turns on <strong className="text-[var(--color-text)]">{matrix.decisiveCriteria.join(", ")}</strong> —
            without {matrix.decisiveCriteria.length === 1 ? "it" : "any one of these"}, a different option would come first.
          </p>
        ) : (
          <p>No single criterion decides it — the leader stays ahead with any one of them removed.</p>
        )}
        {matrix.scoredBy === "jev" && (
          <p className="text-[11.5px] text-[var(--color-text-faint)]">
            Bars average each rating over Jev&apos;s probabilities, so an unsure rating counts for less. A “?” marks
            a rating Jev was less than {pct(UNSURE)} sure of. Hover a cell for its distribution.
          </p>
        )}
      </div>
    </Panel>
  );
}

// How the consensus rating was arrived at — and, when Jev measured it, how the
// probability spread across the four levels.
function ConsensusNote({ detail }: { detail: ConsensusDetail }) {
  if (detail.source !== "jev") return null;
  const disagrees = detail.synthesizerSaid && detail.synthesizerSaid !== detail.level;
  return (
    <details className="mt-4 border-t border-[var(--color-border)] pt-3 text-[12px] text-[var(--color-text-muted)]">
      <summary className="cursor-pointer select-none">
        Consensus measured by Jev
        {detail.confidence !== undefined ? `, ${pct(detail.confidence)} confident` : ""}
        {disagrees ? ` — the Synthesizer called it ${detail.synthesizerSaid}` : ""}
      </summary>
      {detail.probabilities && (
        <div className="mt-2 grid max-w-sm grid-cols-[5.5rem_1fr_2.5rem] items-center gap-x-2 gap-y-1">
          {CONSENSUS_LEVELS.map((level) => {
            const p = detail.probabilities?.[level] ?? 0;
            return (
              <div key={level} className="contents">
                <span className={level === detail.level ? "text-[var(--color-text)]" : ""}>{level}</span>
                <Meter value={p * 10} label={`${level}: ${pct(p)}`} />
                <span className="text-right font-technical text-[11px]">{pct(p)}</span>
              </div>
            );
          })}
        </div>
      )}
      <p className="mt-2 text-[11.5px] text-[var(--color-text-faint)]">
        Rated from the members&apos; own contributions, not the Synthesizer&apos;s summary of them.
      </p>
    </details>
  );
}

const STAGE_LABEL: Record<string, string> = {
  assessment: "Assessments",
  analysis: "Independent analysis",
  critique: "Critique",
  opening: "Opening",
  rebuttal: "Rebuttal",
  proposal: "Proposal",
  attack: "Attack",
  defense: "Defense",
  synthesis: "Synthesis",
};

// Every possible stage across all three modes, in a sensible read order — a
// given run only ever populates the stages its mode actually uses, so the
// empty ones below are simply skipped.
const STAGES = ["assessment", "analysis", "critique", "opening", "rebuttal", "proposal", "attack", "defense", "synthesis"] as const;

const STATUS_LABEL: Record<CouncilRun["status"], string> = {
  running: "Deliberating",
  complete: "Complete",
  error: "Error",
};

interface RecordedNote {
  id: string;
  kind: "decision" | "question";
  content: string;
}

export function CouncilRunView({ runId }: { runId: string }) {
  const [run, setRun] = useState<CouncilRun | null>(null);
  const [project, setProject] = useState<{ id: string; name: string } | null>(null);
  const [notes, setNotes] = useState<RecordedNote[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function load() {
    const res = await fetch(`/api/councils/runs/${runId}`);
    if (!res.ok) return;
    const data = await res.json();
    setRun(data.run);
    setProject(data.project ?? null);
    setNotes(data.notes ?? []);
    if (data.run && data.run.status !== "running" && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  useEffect(() => {
    load();
    pollRef.current = setInterval(load, 2000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  if (!run) return null;

  const isRunning = run.status === "running";

  return (
    <div className="mx-auto max-w-2xl px-8 py-8">
      <div className="mb-3 flex items-center gap-2">
        <Tag tone={isRunning ? "accent" : "default"}>
          {isRunning && <CouncilSpinner className="mr-1" />}
          {STATUS_LABEL[run.status]}
        </Tag>
      </div>

      <div className="mb-6">
        <p className="text-[15px] leading-relaxed text-[var(--color-text)]">{run.question}</p>
        {run.attachments && run.attachments.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {run.attachments.map((a) => (
              <span
                key={a.filename}
                className="inline-flex items-center rounded-[3px] border border-[var(--color-border)] px-1.5 py-0.5 text-[11.5px] text-[var(--color-text-faint)] font-technical"
              >
                {a.filename}
              </span>
            ))}
          </div>
        )}
      </div>

      {run.status === "error" && (
        <Panel className="mb-6 px-4 py-3 text-[13px] text-[var(--color-danger)]">{run.synthesis}</Panel>
      )}

      {run.matrix?.cells && <MatrixPanel matrix={run.matrix} />}

      {run.status === "complete" && (
        <Panel className="mb-8 px-5 py-5">
          <div className="mb-3 flex items-center gap-2">
            <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-[var(--color-text-faint)] font-technical">
              Conclusion
            </span>
            {run.consensus && <Tag tone="accent">Consensus: {run.consensus}</Tag>}
          </div>
          <div className="prose-magi text-[15px]">{renderMarkdown(run.synthesis ?? "")}</div>
          {run.disagreement && run.disagreement.toLowerCase() !== "none" && (
            <div className="mt-4 border-t border-[var(--color-border)] pt-4">
              <div className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.1em] text-[var(--color-text-faint)] font-technical">
                Key disagreement
              </div>
              <p className="text-[13.5px] leading-relaxed text-[var(--color-text-muted)]">{run.disagreement}</p>
            </div>
          )}
          {run.consensus_detail && <ConsensusNote detail={run.consensus_detail} />}
        </Panel>
      )}

      {run.status === "complete" && (
        // The anchor a Council answer in a conversation links to.
        <div id="decision" className="scroll-mt-6">
          <RecordDecision runId={run.id} project={project} notes={notes} onRecorded={setNotes} />
        </div>
      )}

      {STAGES.map((stage) => {
        const entries = run.transcript.filter((t) => t.stage === stage);
        if (entries.length === 0) return null;
        return (
          <section key={stage} className="mb-8">
            <h2 className="mb-2.5 text-[13px] font-semibold uppercase tracking-[0.1em] text-[var(--color-text-faint)] font-technical">
              {STAGE_LABEL[stage]}
            </h2>
            <div className="flex flex-col gap-3">
              {entries.map((e, i) => (
                <Panel key={i} className="px-4 py-4">
                  <div className="mb-2 flex items-center gap-2">
                    <span className="text-[12.5px] font-medium text-[var(--color-text)]">{e.role}</span>
                    <Tag>{e.modelId}</Tag>
                  </div>
                  <div className="prose-magi text-[13.5px]">{renderMarkdown(e.content)}</div>
                  {e.toolCalls && e.toolCalls.length > 0 && (
                    <div className="mt-3 flex flex-col gap-1 border-t border-[var(--color-border)] pt-3">
                      {e.toolCalls.map((t, k) => (
                        <details key={k} className="text-[11.5px] text-[var(--color-text-faint)] font-technical">
                          <summary className="cursor-pointer select-none hover:text-[var(--color-text-muted)]">
                            used {t.name}
                            {t.name === "search_archive" && typeof t.input === "object" && t.input && "query" in t.input
                              ? ` — "${(t.input as { query: string }).query}"`
                              : ""}
                          </summary>
                          <pre className="mt-1.5 whitespace-pre-wrap break-words rounded-[3px] bg-[var(--color-bg-raised)] p-2 text-[11.5px] text-[var(--color-text-muted)]">
                            {t.result}
                          </pre>
                        </details>
                      ))}
                    </div>
                  )}
                </Panel>
              ))}
            </div>
          </section>
        );
      })}

      {isRunning && (
        <Panel className="flex items-center gap-2 px-4 py-4 text-[12.5px] text-[var(--color-text-faint)]">
          <CouncilSpinner />
          The Council is deliberating…
        </Panel>
      )}
    </div>
  );
}

// Recording the conclusion as what the Project has decided — drafted from the
// synthesis, edited here, and kept as the Project's own decision (and, if the
// Council left something unresolved, an open question). From then on it's in
// "Where the work stands" and in every conversation's context in the Project.
function RecordDecision({
  runId,
  project,
  notes,
  onRecorded,
}: {
  runId: string;
  project: { id: string; name: string } | null;
  notes: RecordedNote[];
  onRecorded: (notes: RecordedNote[]) => void;
}) {
  const [draft, setDraft] = useState<{ decision: string; openQuestion: string } | null>(null);
  const [includeQuestion, setIncludeQuestion] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function call(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/councils/runs/${runId}/decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "That didn't work.");
      return null;
    }
    return data;
  }

  const heading = (
    <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.1em] text-[var(--color-text-faint)] font-technical">
      Decision
    </div>
  );

  if (!project) {
    return (
      <Panel className="mb-8 px-5 py-4 text-[12.5px] text-[var(--color-text-muted)]">
        {heading}
        This deliberation wasn&apos;t run in a Project, so there&apos;s nowhere to record its conclusion as a decision.
        Convene the Council with a Project chosen to be able to.
      </Panel>
    );
  }

  if (notes.length) {
    return (
      <Panel className="mb-8 px-5 py-4">
        {heading}
        <ul className="flex flex-col gap-1.5 text-[13.5px] leading-relaxed text-[var(--color-text)]">
          {notes.map((n) => (
            <li key={n.id}>
              <Tag>{n.kind === "decision" ? "Decided" : "Open question"}</Tag> <span className="ml-1">{n.content}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[12px] text-[var(--color-text-muted)]">
          Recorded in{" "}
          <Link href={`/projects/${project.id}`} className="underline decoration-[var(--color-border-strong)] underline-offset-2 hover:text-[var(--color-accent)]">
            {project.name}
          </Link>{" "}
          — part of every conversation there from now on.
        </p>
      </Panel>
    );
  }

  if (!draft) {
    return (
      <Panel className="mb-8 flex flex-wrap items-center gap-3 px-5 py-4">
        <div className="min-w-0 flex-1">
          {heading}
          <p className="text-[12.5px] text-[var(--color-text-muted)]">
            Record this conclusion as what {project.name} has decided, so later conversations there build on it.
          </p>
        </div>
        <Button
          variant="accent"
          disabled={busy}
          onClick={async () => {
            const data = await call({ action: "draft" });
            if (data) setDraft({ decision: data.decision, openQuestion: data.openQuestion ?? "" });
          }}
        >
          {busy ? "Drafting…" : "Record as a decision…"}
        </Button>
        {error && <div className="w-full text-[12px] text-[var(--color-danger)]">{error}</div>}
      </Panel>
    );
  }

  return (
    <Panel className="mb-8 px-5 py-4">
      {heading}
      <Textarea
        autoFocus
        rows={2}
        value={draft.decision}
        onChange={(e) => setDraft({ ...draft, decision: e.target.value })}
        aria-label="Decision"
        className="text-[14px]"
      />
      <label className="mt-3 mb-1 flex items-center gap-2 text-[12px] text-[var(--color-text-muted)]">
        <input type="checkbox" checked={includeQuestion} onChange={(e) => setIncludeQuestion(e.target.checked)} />
        Also record what&apos;s still open
      </label>
      {includeQuestion && (
        <Textarea
          rows={2}
          value={draft.openQuestion}
          onChange={(e) => setDraft({ ...draft, openQuestion: e.target.value })}
          placeholder="The Council didn't leave anything unresolved — or write one here."
          aria-label="Open question"
          className="text-[13.5px]"
        />
      )}
      <div className="mt-3 flex items-center justify-end gap-2">
        <Button variant="ghost" onClick={() => setDraft(null)}>
          Cancel
        </Button>
        <Button
          variant="accent"
          disabled={!draft.decision.trim() || busy}
          onClick={async () => {
            const data = await call({
              action: "record",
              decision: draft.decision,
              openQuestion: includeQuestion ? draft.openQuestion : "",
            });
            if (data) onRecorded(data.notes);
          }}
        >
          Record in {project.name}
        </Button>
      </div>
      {error && <div className="mt-2 text-[12px] text-[var(--color-danger)]">{error}</div>}
    </Panel>
  );
}
