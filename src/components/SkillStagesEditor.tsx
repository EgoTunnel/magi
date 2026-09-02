"use client";

import { Input, Label, Textarea } from "@/components/ui";
import { IconPlus, IconTrash } from "@/components/icons";

export interface SkillStageDraft {
  name: string;
  instructions: string;
  modelRole?: string | null;
  useTools?: boolean;
}
interface RoleInfo {
  id: string;
  label: string;
}

// A Skill with stages is a method with iteration built into it — the thing the
// Vision means by a Skill, rather than a paragraph of advice. An Agent given
// such a Skill runs these stages in place of its built-in
// plan/research/draft/critique/revise pipeline.
export function SkillStagesEditor({
  stages,
  roles,
  onChange,
}: {
  stages: SkillStageDraft[];
  roles: RoleInfo[];
  onChange: (stages: SkillStageDraft[]) => void;
}) {
  const update = (i: number, patch: Partial<SkillStageDraft>) =>
    onChange(stages.map((s, j) => (i === j ? { ...s, ...patch } : s)));

  const move = (i: number, delta: number) => {
    const target = i + delta;
    if (target < 0 || target >= stages.length) return;
    const next = [...stages];
    [next[i], next[target]] = [next[target], next[i]];
    onChange(next);
  };

  return (
    <div className="mb-3">
      <div className="mb-1 flex items-center justify-between">
        <Label>Stages (optional)</Label>
        <button
          onClick={() => onChange([...stages, { name: "", instructions: "", modelRole: null, useTools: false }])}
          className="focus-ring flex items-center gap-1 text-[11.5px] text-[var(--color-text-faint)] transition-colors hover:text-[var(--color-accent)]"
        >
          <IconPlus /> Add stage
        </button>
      </div>
      {stages.length === 0 ? (
        <p className="text-[11.5px] leading-relaxed text-[var(--color-text-muted)]">
          Leave empty for an ordinary single-pass Skill. Add stages to make this a pipeline — an Agent given
          this Skill will run these in order instead of its built-in plan/research/draft/critique/revise
          sequence, and each stage sees everything the earlier ones produced.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {stages.map((stage, i) => (
            <div key={i} className="rounded-[3px] border border-[var(--color-border)] px-3 py-2.5">
              <div className="mb-2 flex items-center gap-2">
                <span className="font-technical text-[11px] text-[var(--color-text-faint)]">{i + 1}</span>
                <Input
                  value={stage.name}
                  onChange={(e) => update(i, { name: e.target.value })}
                  placeholder="Stage name, e.g. Gather evidence"
                />
                <button
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  aria-label="Move up"
                  className="focus-ring px-1 text-[12px] text-[var(--color-text-faint)] transition-colors hover:text-[var(--color-accent)] disabled:opacity-30"
                >
                  ↑
                </button>
                <button
                  onClick={() => move(i, 1)}
                  disabled={i === stages.length - 1}
                  aria-label="Move down"
                  className="focus-ring px-1 text-[12px] text-[var(--color-text-faint)] transition-colors hover:text-[var(--color-accent)] disabled:opacity-30"
                >
                  ↓
                </button>
                <button
                  onClick={() => onChange(stages.filter((_, j) => j !== i))}
                  aria-label="Remove stage"
                  className="focus-ring text-[var(--color-text-faint)] transition-colors hover:text-[var(--color-danger)]"
                >
                  <IconTrash />
                </button>
              </div>
              <Textarea
                value={stage.instructions}
                onChange={(e) => update(i, { instructions: e.target.value })}
                rows={2}
                placeholder="What this stage does, and only this stage"
              />
              <div className="mt-2 flex flex-wrap items-center gap-4">
                <label className="flex items-center gap-1.5 text-[11.5px] text-[var(--color-text-muted)]">
                  Model
                  <select
                    value={stage.modelRole ?? ""}
                    onChange={(e) => update(i, { modelRole: e.target.value || null })}
                    className="focus-ring rounded-[3px] border border-[var(--color-border)] bg-[var(--color-bg)] px-1.5 py-1 text-[11.5px] text-[var(--color-text)]"
                  >
                    <option value="">Skill&apos;s default</option>
                    {roles.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center gap-1.5 text-[11.5px] text-[var(--color-text-muted)]">
                  <input
                    type="checkbox"
                    checked={stage.useTools ?? false}
                    onChange={(e) => update(i, { useTools: e.target.checked })}
                  />
                  Can use tools
                </label>
              </div>
            </div>
          ))}
          <p className="text-[11.5px] text-[var(--color-text-muted)]">
            Only stages that need to look things up should get tools.
          </p>
        </div>
      )}
    </div>
  );
}

export function StageSummary({ stages }: { stages: SkillStageDraft[] }) {
  if (!stages.length) return null;
  return (
    <span className="font-technical text-[11px] text-[var(--color-text-faint)]">
      {stages.length} stage{stages.length === 1 ? "" : "s"}: {stages.map((s) => s.name).join(" → ")}
    </span>
  );
}
