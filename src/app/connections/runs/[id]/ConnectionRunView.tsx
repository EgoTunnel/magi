"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button, Panel, Tag } from "@/components/ui";

interface Finding {
  targetProjectId: string;
  targetProjectName: string;
  relevance: string;
  summary: string;
  toolCalls?: { name: string; input: unknown; result: string }[];
}
interface ConnectionRun {
  id: string;
  source_project_id: string;
  target_project_id: string | null;
  status: "running" | "complete" | "error";
  findings: Finding[];
}

function relevanceTone(relevance: string): "default" | "accent" {
  return /strong|moderate/i.test(relevance) ? "accent" : "default";
}

export function ConnectionRunView({ runId }: { runId: string }) {
  const [run, setRun] = useState<ConnectionRun | null>(null);
  const [sourceName, setSourceName] = useState("");
  const [savedFor, setSavedFor] = useState<Set<string>>(new Set());
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function load() {
    const res = await fetch(`/api/connections/runs/${runId}`);
    if (!res.ok) return;
    const data = await res.json();
    setRun(data.run);
    if (data.run?.status !== "running" && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    if (data.run?.source_project_id) {
      fetch(`/api/projects/${data.run.source_project_id}`)
        .then((r) => r.json())
        .then((d) => setSourceName(d.project?.name ?? ""));
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

  async function saveToMemory(finding: Finding) {
    if (!run) return;
    await fetch("/api/memory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scope: "project",
        projectId: run.source_project_id,
        content: `From connections with "${finding.targetProjectName}": ${finding.summary}`,
        source: `connection:${run.id}`,
      }),
    });
    setSavedFor((s) => new Set(s).add(finding.targetProjectId));
  }

  if (!run) return null;
  const validFindings = run.findings.filter((f) => f.targetProjectId);

  return (
    <div className="mx-auto max-w-2xl px-8 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Tag tone={run.status === "running" ? "accent" : "default"}>{run.status}</Tag>
          <Link href={`/projects/${run.source_project_id}`} className="text-[12px] text-[var(--color-text-faint)] hover:text-[var(--color-text)]">
            back to {sourceName || "Project"}
          </Link>
        </div>
      </div>

      {run.status === "running" && (
        <Panel className="mb-6 px-4 py-3 text-[13px] text-[var(--color-text-muted)]">
          {run.target_project_id
            ? "Investigating…"
            : `Investigating each other Project in turn — ${validFindings.length} done so far…`}
        </Panel>
      )}

      {validFindings.length === 0 && run.status === "complete" && (
        <Panel className="px-4 py-3 text-[13px] text-[var(--color-text-muted)]">
          No other Projects to compare against.
        </Panel>
      )}

      <div className="flex flex-col gap-3">
        {validFindings.map((f) => (
          <Panel key={f.targetProjectId} className="px-4 py-4">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-[13.5px] font-medium text-[var(--color-text)]">{f.targetProjectName}</span>
              <Tag tone={relevanceTone(f.relevance)}>{f.relevance}</Tag>
            </div>
            <div className="prose-magi text-[13.5px]">
              {f.summary.split("\n").map((line, i) => (
                <p key={i}>{line || " "}</p>
              ))}
            </div>
            {f.toolCalls && f.toolCalls.length > 0 && (
              <div className="mt-3 flex flex-col gap-1 border-t border-[var(--color-border)] pt-3">
                {f.toolCalls.map((t, i) => (
                  <div key={i} className="text-[11.5px] text-[var(--color-text-faint)] font-technical">
                    used {t.name}
                    {t.name === "search_archive" && typeof t.input === "object" && t.input && "query" in t.input
                      ? ` — "${(t.input as { query: string }).query}"`
                      : ""}
                  </div>
                ))}
              </div>
            )}
            {!/^none$/i.test(f.relevance) && (
              <div className="mt-3 border-t border-[var(--color-border)] pt-3">
                <Button
                  variant="default"
                  onClick={() => saveToMemory(f)}
                  disabled={savedFor.has(f.targetProjectId)}
                >
                  {savedFor.has(f.targetProjectId) ? "Saved to Project memory" : "Save to Project memory"}
                </Button>
              </div>
            )}
          </Panel>
        ))}
      </div>
    </div>
  );
}
