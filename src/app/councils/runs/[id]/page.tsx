import { notFound } from "next/navigation";
import { getCouncilRun } from "@/lib/repo/councils";
import { PageHeader, Panel, Tag } from "@/components/ui";

const STAGE_LABEL: Record<string, string> = {
  analysis: "Independent analysis",
  critique: "Critique",
  synthesis: "Synthesis",
};

export default async function CouncilRunPage({ params }: PageProps<"/councils/runs/[id]">) {
  const { id } = await params;
  const run = getCouncilRun(id);
  if (!run) notFound();

  const stages: Array<"analysis" | "critique" | "synthesis"> = ["analysis", "critique", "synthesis"];

  return (
    <div>
      <PageHeader eyebrow="Magi Council · Deliberation" title={run.question} />
      <div className="mx-auto max-w-2xl px-8 py-8">
        {run.status === "running" && (
          <Panel className="mb-6 px-4 py-3 text-[13px] text-[var(--color-text-muted)]">
            Still deliberating — refresh in a moment.
          </Panel>
        )}
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
            <div className="prose-magi text-[15px]">
              {(run.synthesis ?? "").split("\n").map((line, i) => (
                <p key={i}>{line || " "}</p>
              ))}
            </div>
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

        {stages.map((stage) => {
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
                    <div className="prose-magi text-[13.5px]">
                      {e.content.split("\n").map((line, j) => (
                        <p key={j}>{line || " "}</p>
                      ))}
                    </div>
                  </Panel>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
