"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, EmptyState, Input, Label, Panel, Tag, Textarea } from "@/components/ui";
import { IconChevronRight, IconDocument, IconDownload, IconPlus, IconTrash } from "@/components/icons";
import { arrayBufferToBase64 } from "@/lib/clientFiles";
import { ArtifactViewerButton } from "@/components/ArtifactHistory";
import { MoveConversationControl } from "@/components/MoveConversationControl";
import { ProjectStanding } from "@/components/ProjectStanding";

interface Project {
  id: string;
  name: string;
  tagline: string | null;
  purpose: string | null;
  instructions: string | null;
  brand_philosophy: string | null;
  brand_heading_font: string | null;
  brand_body_font: string | null;
  brand_primary_color: string | null;
  brand_accent_color: string | null;
  brand_text_color: string | null;
  brand_subtitle_color: string | null;
  brand_label_color: string | null;
  brand_secondary_accent_color: string | null;
  parent_project_id: string | null;
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (hex: string) => void;
}) {
  return (
    <div>
      <Label>{label}</Label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={`#${(value || "888888").replace(/^#/, "")}`}
          onChange={(e) => onChange(e.target.value.replace(/^#/, "").toUpperCase())}
          className="h-[30px] w-[36px] shrink-0 cursor-pointer rounded-[3px] border border-[var(--color-border-strong)] bg-transparent p-0.5"
        />
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/^#/, "").toUpperCase())}
          placeholder="1F3864"
        />
      </div>
    </div>
  );
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
  mime_type: string | null;
  updated_at: string;
}
interface Skill {
  id: string;
  name: string;
  description: string | null;
  scope: string;
  stages?: { name: string }[];
}
interface Artifact {
  id: string;
  title: string;
  type: string;
  version: number;
  mime_type: string | null;
}
interface AgentRun {
  id: string;
  objective: string;
  status: "running" | "stopping" | "stopped" | "complete" | "error";
  created_at: string;
}
interface OtherProject {
  id: string;
  name: string;
  parent_project_id: string | null;
}
interface ConnectionRun {
  id: string;
  target_project_id: string | null;
  status: "running" | "complete" | "error";
  created_at: string;
}
interface InterestRun {
  id: string;
  status: "running" | "complete" | "error";
  findings: { relevance: string }[];
  created_at: string;
}
interface ToolInfo {
  name: string;
  description: string;
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

  const [editingBrandGuide, setEditingBrandGuide] = useState(false);
  const [brandPhilosophyDraft, setBrandPhilosophyDraft] = useState("");
  const [brandHeadingFontDraft, setBrandHeadingFontDraft] = useState("");
  const [brandBodyFontDraft, setBrandBodyFontDraft] = useState("");
  const [brandPrimaryColorDraft, setBrandPrimaryColorDraft] = useState("");
  const [brandAccentColorDraft, setBrandAccentColorDraft] = useState("");
  const [brandTextColorDraft, setBrandTextColorDraft] = useState("");
  const [brandSubtitleColorDraft, setBrandSubtitleColorDraft] = useState("");
  const [brandLabelColorDraft, setBrandLabelColorDraft] = useState("");
  const [brandSecondaryAccentColorDraft, setBrandSecondaryAccentColorDraft] = useState("");

  const [docFormOpen, setDocFormOpen] = useState(false);
  const [docTitle, setDocTitle] = useState("");
  const [docContent, setDocContent] = useState("");
  const [uploadingDoc, setUploadingDoc] = useState(false);
  const [docUploadError, setDocUploadError] = useState<string | null>(null);
  const docFileInputRef = useRef<HTMLInputElement>(null);

  const [agentRuns, setAgentRuns] = useState<AgentRun[]>([]);
  const [agentFormOpen, setAgentFormOpen] = useState(false);
  const [objectiveDraft, setObjectiveDraft] = useState("");
  const [launchingAgent, setLaunchingAgent] = useState(false);
  const [agentError, setAgentError] = useState<string | null>(null);
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [agentAllowedTools, setAgentAllowedTools] = useState<string[] | null>(null);
  const [agentSkillId, setAgentSkillId] = useState("");

  function toggleAgentTool(name: string) {
    setAgentAllowedTools((prev) => {
      const base = prev ?? tools.map((t) => t.name);
      return base.includes(name) ? base.filter((t) => t !== name) : [...base, name];
    });
  }

  const [otherProjects, setOtherProjects] = useState<OtherProject[]>([]);
  const [editingParent, setEditingParent] = useState(false);
  const [parentDraft, setParentDraft] = useState("");
  const [parentError, setParentError] = useState<string | null>(null);
  const [addSubProjectId, setAddSubProjectId] = useState("");
  const [newSubProjectName, setNewSubProjectName] = useState("");
  const [creatingSubProject, setCreatingSubProject] = useState(false);
  const [connectionRuns, setConnectionRuns] = useState<ConnectionRun[]>([]);
  const [connectionFormOpen, setConnectionFormOpen] = useState(false);
  const [connectionTargetId, setConnectionTargetId] = useState("");
  const [launchingConnection, setLaunchingConnection] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [interestRuns, setInterestRuns] = useState<InterestRun[]>([]);
  const [launchingInterest, setLaunchingInterest] = useState(false);
  const [interestError, setInterestError] = useState<string | null>(null);

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
    setBrandPhilosophyDraft(data.project.brand_philosophy ?? "");
    setBrandHeadingFontDraft(data.project.brand_heading_font ?? "");
    setBrandBodyFontDraft(data.project.brand_body_font ?? "");
    setBrandPrimaryColorDraft(data.project.brand_primary_color ?? "");
    setBrandAccentColorDraft(data.project.brand_accent_color ?? "");
    setBrandTextColorDraft(data.project.brand_text_color ?? "");
    setBrandSubtitleColorDraft(data.project.brand_subtitle_color ?? "");
    setBrandLabelColorDraft(data.project.brand_label_color ?? "");
    setBrandSecondaryAccentColorDraft(data.project.brand_secondary_accent_color ?? "");
    setParentDraft(data.project.parent_project_id ?? "");

    const [convRes, memRes, docRes, skillRes, artRes, agentRes, projRes, connRes, interestRes, settingsRes] =
      await Promise.all([
        fetch(`/api/projects/${projectId}/conversations`),
        fetch(`/api/memory?scope=project&projectId=${projectId}`),
        fetch(`/api/documents?projectId=${projectId}`),
        fetch(`/api/skills?projectId=${projectId}`),
        fetch(`/api/artifacts?projectId=${projectId}`),
        fetch(`/api/agents/runs?projectId=${projectId}`),
        fetch(`/api/projects`),
        fetch(`/api/connections/runs?projectId=${projectId}`),
        fetch(`/api/people-interest/runs?projectId=${projectId}`),
        fetch(`/api/settings`),
      ]);
    setConversations((await convRes.json()).conversations);
    const memData: MemoryItem[] = (await memRes.json()).memory;
    setMemory(memData.filter((m) => m.scope === "project"));
    setDocuments((await docRes.json()).documents);
    setSkills((await skillRes.json()).skills);
    setArtifacts((await artRes.json()).artifacts);
    setAgentRuns((await agentRes.json()).runs);
    const allProjects: OtherProject[] = (await projRes.json()).projects;
    setOtherProjects(allProjects.filter((p) => p.id !== projectId));
    setConnectionRuns((await connRes.json()).runs);
    setInterestRuns((await interestRes.json()).runs ?? []);
    setTools((await settingsRes.json()).tools ?? []);
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

  async function saveBrandGuide() {
    await fetch(`/api/projects/${projectId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        brand_philosophy: brandPhilosophyDraft,
        brand_heading_font: brandHeadingFontDraft,
        brand_body_font: brandBodyFontDraft,
        brand_primary_color: brandPrimaryColorDraft,
        brand_accent_color: brandAccentColorDraft,
        brand_text_color: brandTextColorDraft,
        brand_subtitle_color: brandSubtitleColorDraft,
        brand_label_color: brandLabelColorDraft,
        brand_secondary_accent_color: brandSecondaryAccentColorDraft,
      }),
    });
    setEditingBrandGuide(false);
    load();
  }

  // otherProjects carries every other active Project's parent_project_id,
  // so the whole hierarchy can be walked client-side for display and for
  // ruling out choices that would create a loop — the server re-validates
  // this regardless (see updateProject's cycle check), this is just so the
  // dropdowns don't offer an obviously-invalid option in the first place.
  function descendantIds(rootId: string): Set<string> {
    const ids = new Set<string>();
    let frontier = [rootId];
    while (frontier.length) {
      const children = otherProjects.filter((p) => frontier.includes(p.parent_project_id ?? ""));
      frontier = children.map((c) => c.id).filter((id) => !ids.has(id));
      frontier.forEach((id) => ids.add(id));
    }
    return ids;
  }

  function ancestorIds(startId: string): Set<string> {
    const ids = new Set<string>();
    let current = startId === projectId ? project : otherProjects.find((p) => p.id === startId);
    while (current?.parent_project_id && !ids.has(current.parent_project_id)) {
      ids.add(current.parent_project_id);
      current = otherProjects.find((p) => p.id === current!.parent_project_id);
    }
    return ids;
  }

  const childProjects = otherProjects.filter((p) => p.parent_project_id === projectId);
  const parentProject = otherProjects.find((p) => p.id === project?.parent_project_id);
  const myDescendantIds = descendantIds(projectId);
  const eligibleParents = otherProjects.filter((p) => p.id !== projectId && !myDescendantIds.has(p.id));
  const myAncestorIds = ancestorIds(projectId);
  const eligibleSubProjects = otherProjects.filter(
    (p) => p.id !== projectId && p.parent_project_id !== projectId && !myAncestorIds.has(p.id)
  );

  async function saveParent() {
    setParentError(null);
    const res = await fetch(`/api/projects/${projectId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parent_project_id: parentDraft || null }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setParentError(data.error ?? "Couldn't set that parent.");
      return;
    }
    setEditingParent(false);
    load();
  }

  async function addExistingSubProject() {
    if (!addSubProjectId) return;
    await fetch(`/api/projects/${addSubProjectId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parent_project_id: projectId }),
    });
    setAddSubProjectId("");
    load();
  }

  async function removeSubProject(childId: string) {
    await fetch(`/api/projects/${childId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parent_project_id: null }),
    });
    load();
  }

  async function createSubProject() {
    if (!newSubProjectName.trim()) return;
    setCreatingSubProject(true);
    await fetch(`/api/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newSubProjectName, parentProjectId: projectId }),
    });
    setCreatingSubProject(false);
    setNewSubProjectName("");
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

  async function handleUploadDocFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploadingDoc(true);
    setDocUploadError(null);
    try {
      const dataBase64 = arrayBufferToBase64(await file.arrayBuffer());
      const res = await fetch("/api/documents/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, filename: file.name, mimeType: file.type, dataBase64 }),
      });
      const data = await res.json();
      if (!res.ok) {
        setDocUploadError(data.error ?? "Could not upload that file.");
        return;
      }
      load();
    } finally {
      setUploadingDoc(false);
    }
  }

  async function launchAgent() {
    if (!objectiveDraft.trim()) return;
    setLaunchingAgent(true);
    setAgentError(null);
    const res = await fetch("/api/agents/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        objective: objectiveDraft,
        projectId,
        allowedTools: agentAllowedTools,
        skillId: agentSkillId || null,
      }),
    });
    setLaunchingAgent(false);
    if (res.status === 412) {
      const data = await res.json();
      setAgentError(data.message ?? "No API key configured.");
      return;
    }
    const data = await res.json();
    setObjectiveDraft("");
    setAgentAllowedTools(null);
    setAgentFormOpen(false);
    router.push(`/agents/runs/${data.run.id}`);
  }

  async function launchConnection() {
    setLaunchingConnection(true);
    setConnectionError(null);
    const res = await fetch("/api/connections/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceProjectId: projectId, targetProjectId: connectionTargetId || undefined }),
    });
    setLaunchingConnection(false);
    if (res.status === 412) {
      const data = await res.json();
      setConnectionError(data.message ?? "No API key configured.");
      return;
    }
    const data = await res.json();
    setConnectionFormOpen(false);
    router.push(`/connections/runs/${data.run.id}`);
  }

  async function launchInterest() {
    setLaunchingInterest(true);
    setInterestError(null);
    const res = await fetch("/api/people-interest/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId }),
    });
    setLaunchingInterest(false);
    if (res.status === 412) {
      const data = await res.json();
      setInterestError(data.message ?? "Not available yet.");
      return;
    }
    const data = await res.json();
    router.push(`/people-interest/runs/${data.run.id}`);
  }

  if (notFound) {
    return (
      <div className="px-8 py-10">
        <EmptyState title="Project not found" description="It may have been archived or deleted." />
      </div>
    );
  }

  if (!project) return null;

  const agentSkill = skills.find((s) => s.id === agentSkillId);

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

      {/* Above the contents, not among them: what's unresolved, what's
          settled, and what has been happening — the Vision's "place, not
          folder" made literal. Fed by episode closings (src/lib/episodeClose.ts)
          and editable by hand. */}
      <ProjectStanding projectId={projectId} />

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
                  <Panel
                    key={c.id}
                    className="flex items-center justify-between px-3.5 py-2.5 transition-colors hover:border-[var(--color-border-strong)]"
                  >
                    <Link href={`/projects/${projectId}/c/${c.id}`} className="min-w-0 flex-1 truncate">
                      <span className="truncate text-[13.5px] text-[var(--color-text)]">{c.title}</span>
                    </Link>
                    <div className="flex shrink-0 items-center gap-1">
                      <MoveConversationControl conversationId={c.id} currentProjectId={projectId} onMoved={() => load()} />
                      <Link href={`/projects/${projectId}/c/${c.id}`}>
                        <IconChevronRight className="text-[var(--color-text-faint)]" />
                      </Link>
                    </div>
                  </Panel>
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
                {/* An Agent is an actor; a Skill is the method it works by
                    (Product Vision §39). A Skill with stages replaces the
                    built-in pipeline entirely. */}
                <div className="mb-3">
                  <Label>Method</Label>
                  <select
                    value={agentSkillId}
                    onChange={(e) => setAgentSkillId(e.target.value)}
                    className="focus-ring rounded-[3px] border border-[var(--color-border-strong)] bg-[var(--color-bg)] px-2 py-1.5 text-[13px] text-[var(--color-text)]"
                  >
                    <option value="">Built-in: plan → research → draft → critique → revise</option>
                    {skills.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                        {s.stages?.length ? ` (${s.stages.length} stages)` : ""}
                      </option>
                    ))}
                  </select>
                </div>
                <p className="mb-3 text-[12px] text-[var(--color-text-muted)]">
                  {agentSkill?.stages?.length
                    ? `The Agent will work through the "${agentSkill.name}" method — ${agentSkill.stages
                        .map((s) => s.name)
                        .join(" → ")} — and save the result as an artifact in this Project.`
                    : "The Agent will plan, research (using the archive and a calculator), draft, critique itself, revise, and save the result as an artifact in this Project."}{" "}
                  You can watch it work and stop it at any point.
                </p>
                {tools.length > 0 && (
                  <div className="mb-3">
                    <Label>Tools this run may use</Label>
                    <div className="flex flex-wrap gap-3">
                      {tools.map((t) => (
                        <label key={t.name} className="flex items-center gap-1.5 text-[12.5px] text-[var(--color-text-muted)] font-technical">
                          <input
                            type="checkbox"
                            checked={agentAllowedTools === null || agentAllowedTools.includes(t.name)}
                            onChange={() => toggleAgentTool(t.name)}
                          />
                          {t.name}
                        </label>
                      ))}
                    </div>
                  </div>
                )}
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
                description="An Agent is more autonomous than a Skill — give it an objective, and it works through it on its own, using whatever tools and models it needs."
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

          {/* Connections */}
          <section>
            <div className="mb-2.5 flex items-center justify-between">
              <h2 className="text-[13px] font-semibold uppercase tracking-[0.1em] text-[var(--color-text-faint)] font-technical">
                Connections
              </h2>
              <Button variant="ghost" onClick={() => setConnectionFormOpen((v) => !v)}>
                <IconPlus /> Find connections
              </Button>
            </div>
            {connectionFormOpen && (
              <Panel className="mb-3 px-4 py-4">
                <Label>Compare against</Label>
                <select
                  value={connectionTargetId}
                  onChange={(e) => setConnectionTargetId(e.target.value)}
                  className="focus-ring mb-3 w-full rounded-[3px] border border-[var(--color-border-strong)] bg-[var(--color-bg)] px-2 py-1.5 text-[13px] text-[var(--color-text)]"
                >
                  <option value="">All other Projects</option>
                  {otherProjects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <p className="mb-3 text-[12px] text-[var(--color-text-muted)]">
                  Magi will investigate the target Project&apos;s archive and report what genuinely connects
                  to this one — or say plainly if nothing does. The Projects stay separate either way.
                </p>
                {connectionError && (
                  <div className="mb-3 rounded-[4px] border border-[var(--color-accent)] bg-[var(--color-bg)] px-3 py-2 text-[12.5px] text-[var(--color-text)]">
                    {connectionError}
                  </div>
                )}
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" onClick={() => setConnectionFormOpen(false)}>
                    Cancel
                  </Button>
                  <Button variant="accent" onClick={launchConnection} disabled={otherProjects.length === 0 || launchingConnection}>
                    {launchingConnection ? "Starting…" : "Investigate"}
                  </Button>
                </div>
              </Panel>
            )}
            {connectionRuns.length === 0 && !connectionFormOpen ? (
              <EmptyState
                title="No connections explored yet"
                description="Ask what in another Project might be relevant to this one. Magi will actually go look, rather than guess."
              />
            ) : (
              <div className="flex flex-col gap-1.5">
                {connectionRuns.map((c) => (
                  <Link key={c.id} href={`/connections/runs/${c.id}`}>
                    <Panel className="flex items-center justify-between px-3.5 py-2.5 transition-colors hover:border-[var(--color-border-strong)]">
                      <span className="truncate text-[13.5px] text-[var(--color-text)]">
                        {c.target_project_id
                          ? otherProjects.find((p) => p.id === c.target_project_id)?.name ?? "a Project"
                          : "All other Projects"}
                      </span>
                      <div className="flex shrink-0 items-center gap-2">
                        <Tag tone={c.status === "running" ? "accent" : "default"}>{c.status}</Tag>
                        <IconChevronRight className="text-[var(--color-text-faint)]" />
                      </div>
                    </Panel>
                  </Link>
                ))}
              </div>
            )}
          </section>

          {/* Who might be interested? — the People feature's payoff: the same
              "go and look, don't guess" posture as Connections, aimed at
              people rather than Projects. */}
          <section>
            <div className="mb-2.5 flex items-center justify-between">
              <h2 className="text-[13px] font-semibold uppercase tracking-[0.1em] text-[var(--color-text-faint)] font-technical">
                Who might be interested?
              </h2>
              <Button variant="ghost" onClick={launchInterest} disabled={launchingInterest}>
                <IconPlus /> {launchingInterest ? "Starting…" : "Ask"}
              </Button>
            </div>
            {interestError && (
              <div className="mb-3 rounded-[4px] border border-[var(--color-accent)] bg-[var(--color-surface)] px-4 py-3 text-[13px] text-[var(--color-text)]">
                {interestError}{" "}
                <Link href="/people" className="text-[var(--color-accent)] underline">
                  Open People
                </Link>
              </div>
            )}
            {interestRuns.length === 0 ? (
              <EmptyState
                title="Not asked yet"
                description="Weighs each person you know against this Project's actual material, and reports nobody rather than inventing a link."
              />
            ) : (
              <div className="flex flex-col gap-1.5">
                {interestRuns.map((r) => {
                  const real = r.findings.filter((f) => /strong|moderate/i.test(f.relevance)).length;
                  return (
                    <Link key={r.id} href={`/people-interest/runs/${r.id}`}>
                      <Panel className="flex items-center justify-between px-3.5 py-2.5 transition-colors hover:border-[var(--color-border-strong)]">
                        <span className="truncate text-[13.5px] text-[var(--color-text)]">
                          {r.status === "running"
                            ? "Considering…"
                            : real === 0
                              ? "Nobody obviously"
                              : `${real} of ${r.findings.length} may be interested`}
                        </span>
                        <div className="flex shrink-0 items-center gap-2">
                          <Tag tone={r.status === "running" ? "accent" : "default"}>{r.status}</Tag>
                          <IconChevronRight className="text-[var(--color-text-faint)]" />
                        </div>
                      </Panel>
                    </Link>
                  );
                })}
              </div>
            )}
          </section>

          {/* Documents — anchored: retrieved-passage links from a
              conversation's Context panel land here (see sourceLinks.ts). */}
          <section id="documents" className="scroll-mt-6">
            <div className="mb-2.5 flex items-center justify-between">
              <h2 className="text-[13px] font-semibold uppercase tracking-[0.1em] text-[var(--color-text-faint)] font-technical">
                Documents
              </h2>
              <div className="flex items-center gap-2">
                <input
                  ref={docFileInputRef}
                  type="file"
                  accept=".pdf,.docx,.pptx,.txt,.md,.csv,.json"
                  className="hidden"
                  onChange={handleUploadDocFile}
                />
                <Button variant="ghost" onClick={() => docFileInputRef.current?.click()} disabled={uploadingDoc}>
                  <IconPlus /> {uploadingDoc ? "Uploading…" : "Upload"}
                </Button>
                <Button variant="ghost" onClick={() => setDocFormOpen((v) => !v)}>
                  <IconPlus /> Add
                </Button>
              </div>
            </div>
            {docUploadError && (
              <div className="mb-3 rounded-[4px] border border-[var(--color-danger)] px-3 py-2 text-[12.5px] text-[var(--color-danger)]">
                {docUploadError}
              </div>
            )}
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
            <section id="artifacts" className="scroll-mt-6">
              <h2 className="mb-2.5 text-[13px] font-semibold uppercase tracking-[0.1em] text-[var(--color-text-faint)] font-technical">
                Artifacts
              </h2>
              <div className="flex flex-col gap-1.5">
                {artifacts.map((a) => (
                  <Panel key={a.id} className="flex items-center justify-between px-3.5 py-2.5 transition-colors hover:border-[var(--color-border-strong)]">
                    <ArtifactViewerButton
                      artifactId={a.id}
                      onRestored={load}
                      className="flex min-w-0 items-center gap-2 text-left focus-ring"
                    >
                      <IconDocument className="shrink-0 text-[var(--color-text-faint)]" />
                      <span className="truncate text-[13.5px] text-[var(--color-text)]">{a.title}</span>
                    </ArtifactViewerButton>
                    <div className="flex shrink-0 items-center gap-2">
                      <Tag>v{a.version}</Tag>
                      {a.mime_type && (
                        <a
                          href={`/api/artifacts/${a.id}/file`}
                          download
                          aria-label="Download"
                          title="Download"
                          className="focus-ring text-[var(--color-text-faint)] hover:text-[var(--color-accent)]"
                        >
                          <IconDownload />
                        </a>
                      )}
                    </div>
                  </Panel>
                ))}
              </div>
            </section>
          )}
        </div>

        <div className="flex flex-col gap-6">
          {/* Hierarchy — parent Project and sub-projects */}
          <section>
            <h2 className="mb-2.5 text-[13px] font-semibold uppercase tracking-[0.1em] text-[var(--color-text-faint)] font-technical">
              Hierarchy
            </h2>
            <Panel className="px-4 py-4">
              <div className="flex flex-col gap-3 text-[13px]">
                <div>
                  <div className="mb-1 text-[10.5px] font-medium uppercase tracking-[0.1em] text-[var(--color-text-faint)] font-technical">
                    Parent Project
                  </div>
                  {editingParent ? (
                    <div className="flex flex-col gap-2">
                      <select
                        value={parentDraft}
                        onChange={(e) => setParentDraft(e.target.value)}
                        className="focus-ring rounded-[3px] border border-[var(--color-border-strong)] bg-[var(--color-bg)] px-2 py-1.5 text-[13px] text-[var(--color-text)]"
                      >
                        <option value="">None — this Project stands on its own</option>
                        {eligibleParents.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                      {parentError && <div className="text-[12px] text-[var(--color-danger)]">{parentError}</div>}
                      <div className="flex justify-end gap-2">
                        <Button variant="ghost" onClick={() => { setEditingParent(false); setParentError(null); }}>
                          Cancel
                        </Button>
                        <Button variant="accent" onClick={saveParent}>
                          Save
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between">
                      <span className="text-[var(--color-text-muted)]">
                        {parentProject ? (
                          <>
                            Branch of{" "}
                            <Link href={`/projects/${parentProject.id}`} className="text-[var(--color-accent)] hover:underline">
                              {parentProject.name}
                            </Link>
                            {" "}— inherits its instructions and brand guide automatically.
                          </>
                        ) : (
                          "Not set — this Project stands on its own."
                        )}
                      </span>
                      <Button variant="ghost" onClick={() => setEditingParent(true)}>
                        Change
                      </Button>
                    </div>
                  )}
                </div>

                <div>
                  <div className="mb-1 text-[10.5px] font-medium uppercase tracking-[0.1em] text-[var(--color-text-faint)] font-technical">
                    Sub-projects{childProjects.length ? ` (${childProjects.length})` : ""}
                  </div>
                  {childProjects.length === 0 ? (
                    <p className="text-[var(--color-text-muted)]">
                      None — group existing Projects under this one to make it a meta-project, or start a new branch below.
                    </p>
                  ) : (
                    <div className="flex flex-col gap-1">
                      {childProjects.map((c) => (
                        <div key={c.id} className="flex items-center justify-between rounded-[3px] px-1 py-1 hover:bg-[var(--color-surface)]">
                          <Link href={`/projects/${c.id}`} className="truncate text-[var(--color-text)] hover:text-[var(--color-accent)]">
                            {c.name}
                          </Link>
                          <button
                            onClick={() => removeSubProject(c.id)}
                            className="text-[11px] text-[var(--color-text-faint)] hover:text-[var(--color-danger)]"
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {eligibleSubProjects.length > 0 && (
                      <>
                        <select
                          value={addSubProjectId}
                          onChange={(e) => setAddSubProjectId(e.target.value)}
                          className="focus-ring rounded-[3px] border border-[var(--color-border)] bg-[var(--color-bg-raised)] px-2 py-1 text-[11.5px] text-[var(--color-text-muted)]"
                        >
                          <option value="">Add existing Project…</option>
                          {eligibleSubProjects.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                        </select>
                        <Button variant="ghost" onClick={addExistingSubProject} disabled={!addSubProjectId}>
                          Add
                        </Button>
                      </>
                    )}
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <Input
                      value={newSubProjectName}
                      onChange={(e) => setNewSubProjectName(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && createSubProject()}
                      placeholder="New sub-project name"
                      className="max-w-[220px]"
                    />
                    <Button
                      variant="ghost"
                      onClick={createSubProject}
                      disabled={!newSubProjectName.trim() || creatingSubProject}
                    >
                      <IconPlus /> New sub-project
                    </Button>
                  </div>
                </div>
              </div>
            </Panel>
          </section>

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
                      {project.instructions || "Not set — Magi has no special instructions for this Project yet."}
                    </p>
                  </div>
                </div>
              )}
            </Panel>
          </section>

          {/* Brand Guide */}
          <section>
            <div className="mb-2.5 flex items-center justify-between">
              <h2 className="text-[13px] font-semibold uppercase tracking-[0.1em] text-[var(--color-text-faint)] font-technical">
                Brand Guide
              </h2>
              {!editingBrandGuide && (
                <Button variant="ghost" onClick={() => setEditingBrandGuide(true)}>
                  Edit
                </Button>
              )}
            </div>
            <Panel className="px-4 py-4">
              {editingBrandGuide ? (
                <div className="flex flex-col gap-3">
                  <div>
                    <Label>Design philosophy</Label>
                    <Textarea
                      value={brandPhilosophyDraft}
                      onChange={(e) => setBrandPhilosophyDraft(e.target.value)}
                      rows={3}
                      placeholder="How this Project's visual work should feel — tone, imagery, spacing, anything beyond fonts and colors."
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Heading font</Label>
                      <Input
                        value={brandHeadingFontDraft}
                        onChange={(e) => setBrandHeadingFontDraft(e.target.value)}
                        placeholder="e.g. Georgia"
                      />
                    </div>
                    <div>
                      <Label>Body font</Label>
                      <Input
                        value={brandBodyFontDraft}
                        onChange={(e) => setBrandBodyFontDraft(e.target.value)}
                        placeholder="e.g. Calibri"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <ColorField label="Primary" value={brandPrimaryColorDraft} onChange={setBrandPrimaryColorDraft} />
                    <ColorField label="Accent" value={brandAccentColorDraft} onChange={setBrandAccentColorDraft} />
                    <ColorField label="Text" value={brandTextColorDraft} onChange={setBrandTextColorDraft} />
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <ColorField label="Subtitle" value={brandSubtitleColorDraft} onChange={setBrandSubtitleColorDraft} />
                    <ColorField label="Label" value={brandLabelColorDraft} onChange={setBrandLabelColorDraft} />
                    <ColorField
                      label="Secondary accent"
                      value={brandSecondaryAccentColorDraft}
                      onChange={setBrandSecondaryAccentColorDraft}
                    />
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button variant="ghost" onClick={() => setEditingBrandGuide(false)}>
                      Cancel
                    </Button>
                    <Button variant="accent" onClick={saveBrandGuide}>
                      Save
                    </Button>
                  </div>
                </div>
              ) : project.brand_philosophy ||
                project.brand_heading_font ||
                project.brand_body_font ||
                project.brand_primary_color ||
                project.brand_accent_color ||
                project.brand_text_color ||
                project.brand_subtitle_color ||
                project.brand_label_color ||
                project.brand_secondary_accent_color ? (
                <div className="flex flex-col gap-3 text-[13px] leading-relaxed">
                  {project.brand_philosophy && (
                    <p className="whitespace-pre-wrap text-[var(--color-text-muted)]">{project.brand_philosophy}</p>
                  )}
                  {(project.brand_heading_font || project.brand_body_font) && (
                    <div className="text-[var(--color-text-muted)]">
                      Fonts: {project.brand_heading_font || "—"} (headings) / {project.brand_body_font || "—"} (body)
                    </div>
                  )}
                  {(project.brand_primary_color ||
                    project.brand_accent_color ||
                    project.brand_text_color ||
                    project.brand_subtitle_color ||
                    project.brand_label_color ||
                    project.brand_secondary_accent_color) && (
                    <div className="flex flex-wrap items-center gap-3">
                      {[
                        { label: "Primary", hex: project.brand_primary_color },
                        { label: "Secondary accent", hex: project.brand_secondary_accent_color },
                        { label: "Accent", hex: project.brand_accent_color },
                        { label: "Subtitle", hex: project.brand_subtitle_color },
                        { label: "Label", hex: project.brand_label_color },
                        { label: "Text", hex: project.brand_text_color },
                      ]
                        .filter((c) => c.hex)
                        .map((c) => (
                          <div key={c.label} className="flex items-center gap-1.5">
                            <span
                              className="h-3.5 w-3.5 rounded-full border border-[var(--color-border-strong)]"
                              style={{ backgroundColor: `#${c.hex}` }}
                            />
                            <span className="text-[var(--color-text-muted)]">
                              {c.label} #{c.hex}
                            </span>
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-[13px] text-[var(--color-text-muted)]">
                  Not set — Word/PowerPoint/Excel exports use Magi&apos;s default styling, and the model has no brand
                  direction for this Project.
                </p>
              )}
            </Panel>
          </section>

          {/* Image Lab */}
          <section>
            <div className="flex items-center justify-between">
              <h2 className="text-[13px] font-semibold uppercase tracking-[0.1em] text-[var(--color-text-faint)] font-technical">
                Image Lab
              </h2>
              <Link href={`/image-lab?project=${projectId}`}>
                <Button variant="ghost">Open</Button>
              </Link>
            </div>
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
