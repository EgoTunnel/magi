"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, EmptyState, Input, Label, Panel, Tag, Textarea } from "@/components/ui";
import { IconChevronRight, IconPlus, IconTrash } from "@/components/icons";
import { CouncilSpinner } from "@/components/CouncilSpinner";

interface CouncilRole {
  name: string;
  systemPrompt: string;
  modelRole: string;
}
interface Council {
  id: string;
  name: string;
  description: string | null;
  roles: CouncilRole[];
}
interface Run {
  id: string;
  question: string;
  status: string;
  consensus: string | null;
  created_at: string;
}
interface Project {
  id: string;
  name: string;
}
interface RoleInfo {
  id: string;
  label: string;
}

type CouncilMode = "independent" | "debate" | "redTeam";

const DEFAULT_ROLES: CouncilRole[] = [
  {
    name: "Reasoner",
    modelRole: "reasoner",
    systemPrompt: "You are the Reasoner on a Magi Council. Work through the question carefully and rigorously, step by step. State your conclusion plainly.",
  },
  {
    name: "Critic",
    modelRole: "critic",
    systemPrompt: "You are the Critic on a Magi Council. Be skeptical. Look for weak assumptions, missing evidence, and overreach. Argue against easy conclusions.",
  },
  {
    name: "Researcher",
    modelRole: "researcher",
    systemPrompt: "You are the Researcher on a Magi Council. Bring relevant context, precedent, and grounded detail to the question.",
  },
];

// Deliberately topic-agnostic — the question varies, these two stances don't
// presuppose which side of it is "for" or "against."
const DEBATE_DEFAULT_ROLES: CouncilRole[] = [
  {
    name: "Advocate",
    modelRole: "reasoner",
    systemPrompt: "You are the Advocate on a Magi Council Debate. Argue for the strongest, most defensible position on the question — make the best possible case for it.",
  },
  {
    name: "Skeptic",
    modelRole: "critic",
    systemPrompt: "You are the Skeptic on a Magi Council Debate. Argue against that position, or for a genuinely different one. Raise the strongest doubts and counter-considerations you can.",
  },
];

const RED_TEAM_DEFAULT_ROLES: CouncilRole[] = [
  {
    name: "Proposer",
    modelRole: "reasoner",
    systemPrompt: "You are the Proposer on a Magi Council Red Team exercise. Answer the question directly and substantively — this will be attacked, so give your real best answer, not a hedge.",
  },
  {
    name: "Red Team",
    modelRole: "critic",
    systemPrompt: "You are the Red Team on a Magi Council. Attack the Proposer's answer aggressively — find every weakness, edge case, and flaw you can. Do not be diplomatic about it.",
  },
];

const MODE_LABEL: Record<CouncilMode, string> = {
  independent: "Independent Analysis",
  debate: "Debate",
  redTeam: "Red Team",
};

function defaultRolesForMode(mode: CouncilMode): CouncilRole[] {
  if (mode === "debate") return DEBATE_DEFAULT_ROLES;
  if (mode === "redTeam") return RED_TEAM_DEFAULT_ROLES;
  return DEFAULT_ROLES;
}

// Mirrors the validation in POST /api/councils/run — this is a client-side
// echo for a faster/clearer UI response, not a replacement for the server
// check.
function modeRoleError(mode: CouncilMode, roleCount: number): string | null {
  if (mode === "debate" && roleCount !== 2) return "Debate mode needs exactly 2 roles.";
  if (mode === "redTeam" && roleCount < 2) return "Red Team mode needs at least 2 roles.";
  return null;
}

export function CouncilsClient() {
  const router = useRouter();
  const [councils, setCouncils] = useState<Council[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [roleInfos, setRoleInfos] = useState<RoleInfo[]>([]);

  const [question, setQuestion] = useState("");
  const [projectId, setProjectId] = useState("");
  const [selectedCouncilId, setSelectedCouncilId] = useState<string>("__default");
  const [mode, setMode] = useState<CouncilMode>("independent");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [roles, setRoles] = useState<CouncilRole[]>([{ name: "", systemPrompt: "", modelRole: "default" }]);

  async function load() {
    const [councilsRes, runsRes, projRes, modelsRes] = await Promise.all([
      fetch("/api/councils"),
      fetch("/api/councils/runs"),
      fetch("/api/projects"),
      fetch("/api/models"),
    ]);
    setCouncils((await councilsRes.json()).councils);
    setRuns((await runsRes.json()).runs);
    setProjects((await projRes.json()).projects);
    setRoleInfos((await modelsRes.json()).roles);
  }

  useEffect(() => {
    load();
  }, []);

  async function runCouncil() {
    if (!question.trim()) return;
    setRunning(true);
    setError(null);
    const payload: Record<string, unknown> = { question, projectId: projectId || undefined, mode };
    if (selectedCouncilId === "__default") {
      payload.roles = defaultRolesForMode(mode);
    } else {
      payload.councilId = selectedCouncilId;
    }
    const res = await fetch("/api/councils/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    setRunning(false);
    if (!res.ok || !data.run) {
      setError(data.error ?? "Failed to start the Council.");
      return;
    }
    // The run has only just been created (status "running", empty
    // transcript) — deliberation itself continues server-side after this
    // response, so navigate immediately rather than waiting for it to
    // finish; the run page polls for progress from here.
    router.push(`/councils/runs/${data.run.id}`);
  }

  function updateRole(i: number, patch: Partial<CouncilRole>) {
    setRoles((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  async function createCouncil() {
    if (!name.trim() || roles.some((r) => !r.name.trim() || !r.systemPrompt.trim())) return;
    await fetch("/api/councils", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, description, roles }),
    });
    setName("");
    setDescription("");
    setRoles([{ name: "", systemPrompt: "", modelRole: "default" }]);
    setFormOpen(false);
    load();
  }

  async function removeCouncil(id: string) {
    await fetch(`/api/councils/${id}`, { method: "DELETE" });
    load();
  }

  const effectiveRoleCount =
    selectedCouncilId === "__default"
      ? defaultRolesForMode(mode).length
      : councils.find((c) => c.id === selectedCouncilId)?.roles.length ?? 0;
  const roleError = modeRoleError(mode, effectiveRoleCount);

  return (
    <div className="mx-auto max-w-2xl px-8 py-8">
      <section className="mb-10">
        <h2 className="mb-2.5 text-[13px] font-semibold uppercase tracking-[0.1em] text-[var(--color-text-faint)] font-technical">
          Convene the Council
        </h2>
        <Panel className="px-5 py-5">
          <Label>Question</Label>
          <Textarea value={question} onChange={(e) => setQuestion(e.target.value)} rows={3} placeholder="Put a substantial question to the Council…" className="mb-3" />
          <div className="mb-3 flex flex-wrap gap-2">
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as CouncilMode)}
              className="focus-ring rounded-[3px] border border-[var(--color-border-strong)] bg-[var(--color-bg)] px-2 py-1.5 text-[13px] text-[var(--color-text)]"
            >
              {(Object.keys(MODE_LABEL) as CouncilMode[]).map((m) => (
                <option key={m} value={m}>
                  {MODE_LABEL[m]}
                </option>
              ))}
            </select>
            <select
              value={selectedCouncilId}
              onChange={(e) => setSelectedCouncilId(e.target.value)}
              className="focus-ring rounded-[3px] border border-[var(--color-border-strong)] bg-[var(--color-bg)] px-2 py-1.5 text-[13px] text-[var(--color-text)]"
            >
              <option value="__default">
                Default roles ({defaultRolesForMode(mode).map((r) => r.name).join(", ")})
              </option>
              {councils.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className="focus-ring rounded-[3px] border border-[var(--color-border-strong)] bg-[var(--color-bg)] px-2 py-1.5 text-[13px] text-[var(--color-text)]"
            >
              <option value="">No Project context</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          {roleError && (
            <p className="mb-3 text-[12px] text-[var(--color-text-muted)]">{roleError}</p>
          )}
          <Button variant="accent" onClick={runCouncil} disabled={!question.trim() || running || !!roleError}>
            {running ? "The Council is deliberating…" : "Deliberate"}
          </Button>
          {error && (
            <div className="mt-3 rounded-[4px] border border-[var(--color-accent)] bg-[var(--color-bg)] px-4 py-3 text-[13px] text-[var(--color-text)]">
              {error}{" "}
              <Link href="/settings" className="text-[var(--color-accent)] underline">
                Open Settings
              </Link>
            </div>
          )}
        </Panel>
      </section>

      <section className="mb-10">
        <div className="mb-2.5 flex items-center justify-between">
          <h2 className="text-[13px] font-semibold uppercase tracking-[0.1em] text-[var(--color-text-faint)] font-technical">
            Persistent Councils
          </h2>
          <Button variant="ghost" onClick={() => setFormOpen((v) => !v)}>
            <IconPlus /> New Council
          </Button>
        </div>

        {formOpen && (
          <Panel className="mb-4 px-5 py-5">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="mb-3" placeholder="e.g. Writing Council" />
            <Label>Description</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} className="mb-4" placeholder="One line" />
            <Label>Roles</Label>
            <div className="flex flex-col gap-3">
              {roles.map((r, i) => (
                <div key={i} className="rounded-[3px] border border-[var(--color-border)] p-3">
                  <div className="mb-2 flex gap-2">
                    <Input
                      value={r.name}
                      onChange={(e) => updateRole(i, { name: e.target.value })}
                      placeholder="Role name, e.g. Skeptic"
                    />
                    <select
                      value={r.modelRole}
                      onChange={(e) => updateRole(i, { modelRole: e.target.value })}
                      className="focus-ring shrink-0 rounded-[3px] border border-[var(--color-border-strong)] bg-[var(--color-bg)] px-2 text-[13px] text-[var(--color-text)]"
                    >
                      {roleInfos.map((ri) => (
                        <option key={ri.id} value={ri.id}>
                          {ri.label}
                        </option>
                      ))}
                    </select>
                    {roles.length > 1 && (
                      <button onClick={() => setRoles((rs) => rs.filter((_, idx) => idx !== i))} className="focus-ring text-[var(--color-text-faint)] hover:text-[var(--color-danger)]">
                        <IconTrash />
                      </button>
                    )}
                  </div>
                  <Textarea
                    value={r.systemPrompt}
                    onChange={(e) => updateRole(i, { systemPrompt: e.target.value })}
                    rows={2}
                    placeholder="What this role should do"
                  />
                </div>
              ))}
              <Button variant="ghost" onClick={() => setRoles((rs) => [...rs, { name: "", systemPrompt: "", modelRole: "default" }])}>
                <IconPlus /> Add role
              </Button>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setFormOpen(false)}>
                Cancel
              </Button>
              <Button variant="accent" onClick={createCouncil}>
                Save Council
              </Button>
            </div>
          </Panel>
        )}

        {councils.length === 0 && !formOpen ? (
          <EmptyState title="No persistent Councils yet" description="Save a role configuration to reuse it — a Research Council, a Writing Council, whatever recurs in your work." />
        ) : (
          <div className="flex flex-col gap-1.5">
            {councils.map((c) => (
              <Panel key={c.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <div className="text-[13.5px] font-medium text-[var(--color-text)]">{c.name}</div>
                  <div className="text-[12px] text-[var(--color-text-muted)]">{c.roles.map((r) => r.name).join(" · ")}</div>
                </div>
                <button onClick={() => removeCouncil(c.id)} className="focus-ring text-[var(--color-text-faint)] hover:text-[var(--color-danger)]">
                  <IconTrash />
                </button>
              </Panel>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-2.5 text-[13px] font-semibold uppercase tracking-[0.1em] text-[var(--color-text-faint)] font-technical">
          Past deliberations
        </h2>
        {runs.length === 0 ? (
          <EmptyState title="No deliberations yet" />
        ) : (
          <div className="flex flex-col gap-1.5">
            {runs.map((r) => (
              <Link key={r.id} href={`/councils/runs/${r.id}`}>
                <Panel className="flex items-center justify-between px-4 py-3 transition-colors hover:border-[var(--color-border-strong)]">
                  <div className="min-w-0">
                    <div className="truncate text-[13.5px] text-[var(--color-text)]">{r.question}</div>
                    <div className="text-[11.5px] text-[var(--color-text-faint)]">{new Date(r.created_at).toLocaleString()}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {r.status === "running" ? (
                      <Tag tone="accent">
                        <CouncilSpinner className="mr-1" />
                        Running
                      </Tag>
                    ) : (
                      r.consensus && <Tag>{r.consensus}</Tag>
                    )}
                    <IconChevronRight className="text-[var(--color-text-faint)]" />
                  </div>
                </Panel>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
