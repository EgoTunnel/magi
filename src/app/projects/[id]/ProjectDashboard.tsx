"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, EmptyState, Input, Label, Panel, Tag, Textarea } from "@/components/ui";
import { IconChevronRight, IconDocument, IconPlus, IconTrash } from "@/components/icons";

interface Project {
  id: string;
  name: string;
  tagline: string | null;
  purpose: string | null;
  instructions: string | null;
}
interface Conversation {
  id: string;
  title: string;
  updated_at: string;
}
interface MemoryItem {
  id: string;
  scope: "global" | "project";
  content: string;
  created_at: string;
}
interface Doc {
  id: string;
  title: string;
  content: string;
  updated_at: string;
}
interface Skill {
  id: string;
  name: string;
  description: string | null;
  scope: string;
}
interface Artifact {
  id: string;
  title: string;
  type: string;
  version: number;
}
interface AgentRun {
  id: string;
  objective: string;
  status: "running" | "stopping" | "stopped" | "complete" | "error";
  created_at: string;
}

export function ProjectDashboard({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [project, setProject] = useState<Project | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [memory, setMemory] = useState<MemoryItem[]>([]);
  const [documents, setDocuments] = useState<Doc[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [notFound, setNotFound] = useState(false);

  const [editingInstructions, setEditingInstructions] = useState(false);
  const [instructionsDraft, setInstructionsDraft] = useState("");
  const [purposeDraft, setPurposeDraft] = useState("");

  const [docFormOpen, setDocFormOpen] = useState(false);
  const [docTitle, setDocTitle] = useState("");
  const [docContent, setDocContent] = useState("");

  const [agentRuns, setAgentRuns] = useState<AgentRun[]>([]);
  const [agentFormOpen, setAgentFormOpen] = useState(false);
  const [objectiveDraft, setObjectiveDraft] = useState("");
  const [launchingAgent, setLaunchingAgent] = useState(false);
  const [agentError, setAgentError] = useState<string | null>(null);

  async function load() {
    const res = await fetch(`/api/projects/${projectId}`);
    if (res.status === 404) {
      setNotFound(true);
      return;
    }
    const data = await res.json();
    setProject(data.project);
    setInstructionsDraft(data.project.instructions ?? "");
    setPurposeDraft(data.project.purpose ?? "");

    const [convRes, memRes, docRes, skillRes, artRes, agentRes] = await Promise.all([
      fetch(`/api/projects/${projectId}/conversations`),
      fetch(`/api/memory?scope=project&projectId=${projectId}`),
      fetch(`/api/documents?projectId=${projectId}`),
      fetch(`/api/skills?projectId=${projectId}`),
      fetch(`/api/artifacts?projectId=${projectId}`),
      fetch(`/api/agents/runs?projectId=${projectId}`),
    ]);
    setConversations((await convRes.json()).conversations);
    const memData: MemoryItem[] = (await memRes.json()).memory;
    setMemory(memData.filter((m) => m.scope === "project"));
    setDocuments((await docRes.json()).documents);
    setSkills((await skillRes.json()).skills);
    setArtifacts((await artRes.json()).artifacts);
    setAgentRuns((await agentRes.json()).runs);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function saveInstructions() {
    await fetch(`/api/projects/${projectId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instructions: instructionsDraft, purpose: purposeDraft }),
    });
    setEditingInstructions(false);
    load();
  }

  async function newConversation() {
    const res = await fetch(`/api/projects/${projectId}/conversations`, { method: "POST" });
    const data = await res.json();
    router.push(`/projects/${projectId}/c/${data.conversation.id}`);
  }

  async function addDocument() {
    if (!docTitle.trim()) return;
    await fetch(`/api/documents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, title: docTitle, content: docContent }),
    });
    setDocTitle("");
    setDocContent("");
    setDocFormOpen(false);
    load();
  }

  async function removeDocument(id: string) {
    await fetch(`/api/documents/${id}`, { method: "DELETE" });
    load();
  }

  async function launchAgent() {
    if (!objectiveDraft.trim()) return;
    setLaunchingAgent(true);
    setAgentError(null);
    const res = await fetch("/api/agents/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ objective: objectiveDraft, projectId }),
    });
    setLaunchingAgent(false);
    if (res.status === 412) {
      const data = await res.json();
      setAgentError(data.message ?? "No API key configured.");
      return;
    }
    const data = await res.json();
    setObjectiveDraft("");
    setAgentFormOpen(false);
    router.push(`/agents/runs/${data.run.id}`);
  }

  if (notFound) {
    return (
      <div className="px-8 py-10">
        <EmptyState title="Project not found" description="It may have been archived or deleted." />
      </div>
    );
  }

  if (!project) return null;

  return (
    <div>
      <div className="flex items-start justify-between gap-6 border-b border-[var(--color-border)] px-8 py-6">
        <div>
          <div className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--color-text-faint)] font-technical">
            Project
          </div>
          <h1 className="text-[22px] font-semibold tracking-[-0.01em] text-[var(--color-text)]">
            {project.name}
          </h1>
          {project.tagline && <p className="mt-1 text-[13.5px] text-[var(--color-text-muted)]">{project.tagline}</p>}
        </div>
        <Button variant="ghost" onClick={() => (window.location.href = `/api/projects/${projectId}/export`)}>
          Export
        </Button>
      </div>

      <div className="mx-auto grid max-w-5xl grid-cols-1 gap-6 px-8 py-7 lg:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-6">
          {/* Conversations */}
          <section>
            <div className="mb-2.5 flex items-center justify-between">
              <h2 className="text-[13px] font-semibold uppercase tracking-[0.1em] text-[var(--color-text-faint)] font-technical">
                Conversations
              </h2>
              <Button variant="accent" onClick={newConversation}>
                <IconPlus /> New
              </Button>
            </div>
            {conversations.length === 0 ? (
              <EmptyState title="No conversations yet" description="Start one — this is where thinking happens." />
            ) : (
              <div className="flex flex-col gap-1.5">
                {conversations.map((c) => (
                  <Link key={c.id} href={`/projects/${projectId}/c/${c.id}`}>
                    <Panel className="flex items-center justify-between px-3.5 py-2.5 transition-colors hover:border-[var(--color-border-strong)]">
                      <span className="truncate text-[13.5px] text-[var(--color-text)]">{c.title}</span>
                      <IconChevronRight className="shrink-0 text-[var(--color-text-faint)]" />
                    </Panel>
                  </Link>
                ))}
              </div>
            )}
          </section>

          {/* Agents */}
          <section>
            <div className="mb-2.5 flex items-center justify-between">
              <h2 className="text-[13px] font-semibold uppercase tracking-[0.1em] text-[var(--color-text-faint)] font-technical">
                Agents
              </h2>
              <Button variant="ghost" onClick={() => setAgentFormOpen((v) => !v)}>
                <IconPlus /> Pursue an objective
              </Button>
            </div>
            {agentFormOpen && (
              <Panel className="mb-3 px-4 py-4">
                <Label>Objective</Label>
                <Textarea
                  value={objectiveDraft}
                  onChange={(e) => setObjectiveDraft(e.target.value)}
                  rows={3}
                  className="mb-3"
                  placeholder="Investigate whether X is defensible and produce a report…"
                />
                <p className="mb-3 text-[12px] text-[var(--color-text-muted)]">
                  The Agent will plan, research (using the archive and a calculator), draft, critique itself,
                  revise, and save the result as an artifact in this Project. You can watch it work and stop
                  it at any point.
                </p>
                {agentError && (
                  <div className="mb-3 rounded-[4px] border border-[var(--color-accent)] bg-[var(--color-bg)] px-3 py-2 text-[12.5px] text-[var(--color-text)]">
                    {agentError}
                  </div>
                )}
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" onClick={() => setAgentFormOpen(false)}>
                    Cancel
                  </Button>
                  <Button variant="accent" onClick={launchAgent} disabled={!objectiveDraft.trim() || launchingAgent}>
                    {launchingAgent ? "Starting…" : "Start Agent"}
                  </Button>
                </div>
              </Panel>
            )}
            {agentRuns.length === 0 && !agentFormOpen ? (
              <EmptyState
                title="No Agents run yet"
                description="An Agent is more autonomous than a Skill — give it an objective and it pursues it using tools and models on your behalf."
              />
            ) : (
              <div className="flex flex-col gap-1.5">
                {agentRuns.map((a) => (
                  <Link key={a.id} href={`/agents/runs/${a.id}`}>
                    <Panel className="flex items-center justify-between px-3.5 py-2.5 transition-colors hover:border-[var(--color-border-strong)]">
                      <span className="truncate text-[13.5px] text-[var(--color-text)]">{a.objective}</span>
                      <div className="flex shrink-0 items-center gap-2">
                        <Tag tone={a.status === "running" || a.status === "stopping" ? "accent" : "default"}>
                          {a.status}
                        </Tag>
                        <IconChevronRight className="text-[var(--color-text-faint)]" />
                      </div>
                    </Panel>
                  </Link>
                ))}
              </div>
            )}
          </section>

          {/* Documents */}
          <section>
            <div className="mb-2.5 flex items-center justify-between">
              <h2 className="text-[13px] font-semibold uppercase tracking-[0.1em] text-[var(--color-text-faint)] font-technical">
                Documents
              </h2>
              <Button variant="ghost" onClick={() => setDocFormOpen((v) => !v)}>
                <IconPlus /> Add
              </Button>
            </div>
            {docFormOpen && (
              <Panel className="mb-3 px-4 py-4">
                <Label>Title</Label>
                <Input value={docTitle} onChange={(e) => setDocTitle(e.target.value)} className="mb-3" />
                <Label>Content</Label>
                <Textarea value={docContent} onChange={(e) => setDocContent(e.target.value)} rows={6} className="mb-3" />
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" onClick={() => setDocFormOpen(false)}>
                    Cancel
                  </Button>
                  <Button variant="accent" onClick={addDocument}>
                    Save Document
                  </Button>
                </div>
              </Panel>
            )}
            {documents.length === 0 && !docFormOpen ? (
              <EmptyState title="No documents" description="Documents stay available to every conversation, Skill, and Council in this Project." />
            ) : (
              <div className="flex flex-col gap-1.5">
                {documents.map((d) => (
                  <Panel key={d.id} className="flex items-center justify-between px-3.5 py-2.5">
                    <div className="flex min-w-0 items-center gap-2">
                      <IconDocument className="shrink-0 text-[var(--color-text-faint)]" />
                      <span className="truncate text-[13.5px] text-[var(--color-text)]">{d.title}</span>
                    </div>
                    <button onClick={() => removeDocument(d.id)} className="focus-ring text-[var(--color-text-faint)] hover:text-[var(--color-danger)]">
                      <IconTrash />
                    </button>
                  </Panel>
                ))}
              </div>
            )}
          </section>

          {/* Artifacts */}
          {artifacts.length > 0 && (
            <section>
              <h2 className="mb-2.5 text-[13px] font-semibold uppercase tracking-[0.1em] text-[var(--color-text-faint)] font-technical">
                Artifacts
              </h2>
              <div className="flex flex-col gap-1.5">
                {artifacts.map((a) => (
                  <Panel key={a.id} className="flex items-center justify-between px-3.5 py-2.5">
                    <span className="truncate text-[13.5px] text-[var(--color-text)]">{a.title}</span>
                    <Tag>v{a.version}</Tag>
                  </Panel>
                ))}
              </div>
            </section>
          )}
        </div>

        <div className="flex flex-col gap-6">
          {/* Purpose & instructions */}
          <section>
            <div className="mb-2.5 flex items-center justify-between">
              <h2 className="text-[13px] font-semibold uppercase tracking-[0.1em] text-[var(--color-text-faint)] font-technical">
                Instructions
              </h2>
              {!editingInstructions && (
                <Button variant="ghost" onClick={() => setEditingInstructions(true)}>
                  Edit
                </Button>
              )}
            </div>
            <Panel className="px-4 py-4">
              {editingInstructions ? (
                <div className="flex flex-col gap-3">
                  <div>
                    <Label>Purpose</Label>
                    <Textarea value={purposeDraft} onChange={(e) => setPurposeDraft(e.target.value)} rows={2} />
                  </div>
                  <div>
                    <Label>Instructions</Label>
                    <Textarea value={instructionsDraft} onChange={(e) => setInstructionsDraft(e.target.value)} rows={6} />
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button variant="ghost" onClick={() => setEditingInstructions(false)}>
                      Cancel
                    </Button>
                    <Button variant="accent" onClick={saveInstructions}>
                      Save
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-3 text-[13px] leading-relaxed">
                  <div>
                    <div className="mb-1 text-[10.5px] font-medium uppercase tracking-[0.1em] text-[var(--color-text-faint)] font-technical">
                      Purpose
                    </div>
                    <p className="text-[var(--color-text-muted)]">{project.purpose || "Not set"}</p>
                  </div>
                  <div>
                    <div className="mb-1 text-[10.5px] font-medium uppercase tracking-[0.1em] text-[var(--color-text-faint)] font-technical">
                      Instructions
                    </div>
                    <p className="whitespace-pre-wrap text-[var(--color-text-muted)]">
                      {project.instructions || "Not set — Magi will use only its general disposition here."}
                    </p>
                  </div>
                </div>
              )}
            </Panel>
          </section>

          {/* Memory */}
          <section>
            <div className="mb-2.5 flex items-center justify-between">
              <h2 className="text-[13px] font-semibold uppercase tracking-[0.1em] text-[var(--color-text-faint)] font-technical">
                Project memory
              </h2>
              <Link href="/memory">
                <Button variant="ghost">Manage</Button>
              </Link>
            </div>
            <Panel className="px-4 py-3">
              {memory.length === 0 ? (
                <p className="text-[12.5px] text-[var(--color-text-faint)]">
                  Nothing retained yet. Promote a fact from a conversation to start.
                </p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {memory.slice(0, 6).map((m) => (
                    <li key={m.id} className="text-[12.5px] leading-snug text-[var(--color-text-muted)]">
                      {m.content}
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </section>

          {/* Skills */}
          <section>
            <div className="mb-2.5 flex items-center justify-between">
              <h2 className="text-[13px] font-semibold uppercase tracking-[0.1em] text-[var(--color-text-faint)] font-technical">
                Skills available here
              </h2>
              <Link href="/skills">
                <Button variant="ghost">Manage</Button>
              </Link>
            </div>
            <Panel className="px-4 py-3">
              {skills.length === 0 ? (
                <p className="text-[12.5px] text-[var(--color-text-faint)]">No Skills yet.</p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {skills.map((s) => (
                    <li key={s.id} className="flex items-center justify-between text-[12.5px] text-[var(--color-text-muted)]">
                      {s.name}
                      <Tag>{s.scope}</Tag>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </section>
        </div>
      </div>
    </div>
  );
}
