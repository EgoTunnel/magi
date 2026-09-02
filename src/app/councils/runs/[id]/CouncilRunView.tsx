"use client";

import { useEffect, useRef, useState } from "react";
import { Panel, Tag } from "@/components/ui";
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
interface CouncilRun {
  id: string;
  question: string;
  status: "running" | "complete" | "error";
  attachments: RunAttachment[];
  transcript: CouncilTranscriptEntry[];
  consensus: string | null;
  disagreement: string | null;
  synthesis: string | null;
}

const STAGE_LABEL: Record<string, string> = {
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
const STAGES = ["analysis", "critique", "opening", "rebuttal", "proposal", "attack", "defense", "synthesis"] as const;

const STATUS_LABEL: Record<CouncilRun["status"], string> = {
  running: "Deliberating",
  complete: "Complete",
  error: "Error",
};

export function CouncilRunView({ runId }: { runId: string }) {
  const [run, setRun] = useState<CouncilRun | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function load() {
    const res = await fetch(`/api/councils/runs/${runId}`);
    if (!res.ok) return;
    const data = await res.json();
    setRun(data.run);
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
        </Panel>
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
