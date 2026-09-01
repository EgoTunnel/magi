"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button, Panel, Tag } from "@/components/ui";
import { renderMarkdown } from "@/lib/markdownToReact";
import { MagiSpinner } from "@/components/MagiSpinner";

interface AgentStep {
  id: string;
  type: "plan" | "research" | "draft" | "critique" | "revise" | "final" | "error";
  title: string;
  content: string;
  toolCalls?: { name: string; input: unknown; result: string }[];
  createdAt: string;
}
interface AgentRun {
  id: string;
  project_id: string | null;
  objective: string;
  status: "running" | "stopping" | "stopped" | "complete" | "error";
  steps: AgentStep[];
  artifact_id: string | null;
}

const STEP_LABEL: Record<AgentStep["type"], string> = {
  plan: "Plan",
  research: "Research",
  draft: "Draft",
  critique: "Critique",
  revise: "Final draft",
  final: "Done",
  error: "Stopped",
};

const STATUS_LABEL: Record<AgentRun["status"], string> = {
  running: "Working",
  stopping: "Stopping…",
  stopped: "Stopped",
  complete: "Complete",
  error: "Error",
};

export function AgentRunView({ runId }: { runId: string }) {
  const [run, setRun] = useState<AgentRun | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function load() {
    const res = await fetch(`/api/agents/runs/${runId}`);
    if (!res.ok) return;
    const data = await res.json();
    setRun(data.run);
    if (data.run && !["running", "stopping"].includes(data.run.status) && pollRef.current) {
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

  async function stop() {
    await fetch(`/api/agents/runs/${runId}/stop`, { method: "POST" });
    load();
  }

  if (!run) return null;

  const isActive = run.status === "running" || run.status === "stopping";

  return (
    <div className="mx-auto max-w-2xl px-8 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Tag tone={isActive ? "accent" : "default"}>
            {isActive && <MagiSpinner className="mr-1" />}
            {STATUS_LABEL[run.status]}
          </Tag>
          {run.project_id && (
            <Link href={`/projects/${run.project_id}`} className="text-[12px] text-[var(--color-text-faint)] hover:text-[var(--color-text)]">
              back to Project
            </Link>
          )}
        </div>
        {run.status === "running" && (
          <Button variant="danger" onClick={stop}>
            Stop
          </Button>
        )}
      </div>

      <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.1em] text-[var(--color-text-faint)] font-technical">
        Objective
      </p>
      <p className="mb-8 text-[16px] leading-relaxed text-[var(--color-text)] font-editorial">{run.objective}</p>

      <div className="flex flex-col gap-3">
        {run.steps.map((step) => (
          <Panel key={step.id} className={`px-4 py-4 ${step.type === "error" ? "border-[var(--color-danger)]" : ""}`}>
            <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.1em] text-[var(--color-text-faint)] font-technical">
              {STEP_LABEL[step.type]}
            </div>
            <div className="prose-magi text-[13.5px]">
              {renderMarkdown(step.content)}
            </div>
            {step.toolCalls && step.toolCalls.length > 0 && (
              <div className="mt-3 flex flex-col gap-1 border-t border-[var(--color-border)] pt-3">
                {step.toolCalls.map((t, i) => (
                  <div key={i} className="text-[11.5px] text-[var(--color-text-faint)] font-technical">
                    used {t.name}
                    {t.name === "search_archive" && typeof t.input === "object" && t.input && "query" in t.input
                      ? ` — "${(t.input as { query: string }).query}"`
                      : ""}
                  </div>
                ))}
              </div>
            )}
          </Panel>
        ))}
        {isActive && (
          <Panel className="flex items-center gap-2 px-4 py-4 text-[12.5px] text-[var(--color-text-faint)]">
            <MagiSpinner />
            {run.status === "stopping" ? "Finishing the current step before stopping…" : "Working on the next step…"}
          </Panel>
        )}
      </div>

      {run.artifact_id && run.project_id && (
        <div className="mt-8 border-t border-[var(--color-border)] pt-6">
          <Link href={`/projects/${run.project_id}`}>
            <Button variant="accent">View saved artifact in Project</Button>
          </Link>
        </div>
      )}
    </div>
  );
}
