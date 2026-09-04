"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button, EmptyState, Panel, Tag } from "@/components/ui";
import { renderMarkdown } from "@/lib/markdownToReact";

interface Finding {
  personId: string;
  personName: string;
  relationship: string | null;
  relevance: string;
  summary: string;
  alreadyOnProject: boolean;
  toolCalls?: { name: string; input: unknown; result: string }[];
}
interface Run {
  id: string;
  project_id: string;
  status: "running" | "complete" | "error";
  findings: Finding[];
  expected: number;
  skipped: string[];
}

function isReal(relevance: string): boolean {
  return /strong|moderate/i.test(relevance);
}

export function PeopleInterestRunView({ runId }: { runId: string }) {
  const [run, setRun] = useState<Run | null>(null);
  const [projectName, setProjectName] = useState("");
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [showAll, setShowAll] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function load() {
    const res = await fetch(`/api/people-interest/runs/${runId}`);
    if (!res.ok) return;
    const data = await res.json();
    setRun(data.run);
    if (data.run?.status !== "running" && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    if (data.run?.project_id) {
      fetch(`/api/projects/${data.run.project_id}`)
        .then((r) => r.json())
        .then((d) => setProjectName(d.project?.name ?? ""));
    }
  }

  useEffect(() => {
    load();
    pollRef.current = setInterval(load, 2500);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  // A finding is Magi's judgement, not a fact about the person — so promoting
  // one writes it to *Project* memory, attributed to this run, rather than
  // silently becoming something "known" about them on their own page.
  async function saveToMemory(finding: Finding) {
    if (!run) return;
    await fetch("/api/memory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scope: "project",
        projectId: run.project_id,
        content: `${finding.personName} may be relevant here: ${finding.summary}`,
        source: `people_interest:${run.id}`,
      }),
    });
    setSaved((s) => new Set(s).add(finding.personId));
  }

  if (!run) return null;

  const findings = run.findings.filter((f) => f.personId);
  const errors = run.findings.filter((f) => !f.personId);
  const relevant = findings.filter((f) => isReal(f.relevance));
  const shown = showAll ? findings : relevant;

  return (
    <div className="mx-auto max-w-2xl px-8 py-8">
      <div className="mb-6 flex items-center gap-2">
        <Tag tone={run.status === "running" ? "accent" : "default"}>{run.status}</Tag>
        <Link
          href={`/projects/${run.project_id}`}
          className="text-[12px] text-[var(--color-text-faint)] hover:text-[var(--color-text)]"
        >
          back to {projectName || "Project"}
        </Link>
      </div>

      {errors.map((e, i) => (
        <Panel key={i} className="mb-4 px-4 py-3 text-[13px] text-[var(--color-danger)]">
          {e.summary}
        </Panel>
      ))}

      {run.status === "running" && (
        <Panel className="mb-6 px-4 py-3 text-[13px] text-[var(--color-text-muted)]">
          Weighing each person against this Project — {findings.length}
          {run.expected ? ` of ${run.expected}` : ""} done.
        </Panel>
      )}

      {run.skipped?.length > 0 && (
        <p className="mb-4 text-[12px] text-[var(--color-text-faint)]">
          {run.skipped.length} {run.skipped.length === 1 ? "person was" : "people were"} not weighed, having no link to
          this Project and no mention anywhere in the archive: {run.skipped.slice(0, 8).join(", ")}
          {run.skipped.length > 8 ? `, and ${run.skipped.length - 8} more` : ""}.
        </p>
      )}

      {run.status === "complete" && relevant.length === 0 && (
        <div className="mb-4">
          <EmptyState
            title="Nobody obviously"
            description={`${findings.length} ${findings.length === 1 ? "person was" : "people were"} considered and none has a real connection to this work. That is a normal answer — a weak link would be worse than none.`}
          />
        </div>
      )}

      {findings.length > relevant.length && (
        <div className="mb-4">
          <Button variant="ghost" onClick={() => setShowAll((v) => !v)}>
            {showAll
              ? `Show only the ${relevant.length} with a real connection`
              : `Show all ${findings.length} considered, including the ${findings.length - relevant.length} with none`}
          </Button>
        </div>
      )}

      <div className="flex flex-col gap-3">
        {shown.map((f) => (
          <Panel key={f.personId} className="px-4 py-4">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-[13.5px] font-medium text-[var(--color-text)]">
                <Link href={`/people/${f.personId}`} className="hover:text-[var(--color-accent)] transition-colors">
                  {f.personName}
                </Link>
                {f.relationship && (
                  <span className="ml-2 text-[12px] font-normal text-[var(--color-text-faint)]">{f.relationship}</span>
                )}
              </span>
              <div className="flex items-center gap-2">
                {f.alreadyOnProject && <Tag>Already here</Tag>}
                <Tag tone={isReal(f.relevance) ? "accent" : "default"}>{f.relevance}</Tag>
              </div>
            </div>
            <div className="prose-magi text-[13.5px]">{renderMarkdown(f.summary)}</div>
            {f.toolCalls && f.toolCalls.length > 0 && (
              <div className="mt-3 flex flex-col gap-1 border-t border-[var(--color-border)] pt-3">
                {f.toolCalls.map((t, i) => (
                  <div key={i} className="text-[11.5px] text-[var(--color-text-faint)] font-technical">
                    used {t.name}
                    {typeof t.input === "object" && t.input && "query" in t.input
                      ? ` — "${(t.input as { query: string }).query}"`
                      : ""}
                  </div>
                ))}
              </div>
            )}
            {isReal(f.relevance) && (
              <div className="mt-3 border-t border-[var(--color-border)] pt-3">
                <Button onClick={() => saveToMemory(f)} disabled={saved.has(f.personId)}>
                  {saved.has(f.personId) ? "Saved to Project memory" : "Save to Project memory"}
                </Button>
              </div>
            )}
          </Panel>
        ))}
      </div>
    </div>
  );
}
