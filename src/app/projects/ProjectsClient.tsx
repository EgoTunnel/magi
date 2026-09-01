"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, EmptyState, Input, Label, Panel, Tag, Textarea } from "@/components/ui";
import { IconPlus, IconPin, IconTrash } from "@/components/icons";

interface Project {
  id: string;
  name: string;
  tagline: string | null;
  purpose: string | null;
  status: string;
  updated_at: string;
  parent_project_id: string | null;
  pinned: number;
}
interface ProjectCounts {
  conversations: number;
  memory: number;
  documents: number;
  artifacts: number;
  skills: number;
}
interface ClaudeAccountImportSummary {
  projectsCreated: number;
  conversationsImported: number;
  conversationsSkippedEmpty: number;
  documentsImported: number;
  artifactsImported: number;
  memoryItemsImported: number;
}

export function ProjectsClient() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<"active" | "archived">("active");
  const router = useRouter();
  // Read the ?new=1 query param on the client only, rather than via
  // next/navigation's useSearchParams() — that hook requires a Suspense
  // boundary, and Suspense + SSR streaming got stuck (rendered but never
  // revealed) on a fresh hard load of a URL, the same issue documented in
  // ImageLabClient.tsx for its ?project= param. This sidesteps it.
  const [formOpen, setFormOpen] = useState(false);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("new") === "1") setFormOpen(true);
  }, []);

  const [moveOpenFor, setMoveOpenFor] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);
  const [deleteCounts, setDeleteCounts] = useState<ProjectCounts | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [name, setName] = useState("");
  const [tagline, setTagline] = useState("");
  const [purpose, setPurpose] = useState("");
  const [instructions, setInstructions] = useState("");
  const [creating, setCreating] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [claudeImportOpen, setClaudeImportOpen] = useState(false);
  const [claudeConversationsFile, setClaudeConversationsFile] = useState<File | null>(null);
  const [claudeProjectsFile, setClaudeProjectsFile] = useState<File | null>(null);
  const [claudeMemoriesFile, setClaudeMemoriesFile] = useState<File | null>(null);
  const [claudeImporting, setClaudeImporting] = useState(false);
  const [claudeImportError, setClaudeImportError] = useState<string | null>(null);
  const [claudeImportSummary, setClaudeImportSummary] = useState<ClaudeAccountImportSummary | null>(null);

  async function load() {
    setLoading(true);
    const res = await fetch(`/api/projects?status=${statusFilter}`);
    const data = await res.json();
    setProjects(data.projects);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  async function togglePin(p: Project) {
    await fetch(`/api/projects/${p.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pinned: p.pinned ? 0 : 1 }),
    });
    load();
  }

  async function setArchived(p: Project, archived: boolean) {
    await fetch(`/api/projects/${p.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: archived ? "archived" : "active" }),
    });
    load();
  }

  // A Project can't become its own or its own descendant's parent — walk
  // down from candidate parent p to see if it ever reaches `of`.
  function isDescendantOf(candidateId: string, of: string): boolean {
    let current = projects.find((q) => q.id === candidateId);
    const seen = new Set<string>();
    while (current?.parent_project_id && !seen.has(current.id)) {
      if (current.parent_project_id === of) return true;
      seen.add(current.id);
      current = projects.find((q) => q.id === current!.parent_project_id);
    }
    return false;
  }

  async function reparent(p: Project, newParentId: string) {
    await fetch(`/api/projects/${p.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parent_project_id: newParentId || null }),
    });
    setMoveOpenFor(null);
    load();
  }

  async function openDeleteConfirm(p: Project) {
    setDeleteTarget(p);
    setDeleteCounts(null);
    const res = await fetch(`/api/projects/${p.id}`);
    const data = await res.json();
    setDeleteCounts(data.counts ?? null);
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    await fetch(`/api/projects/${deleteTarget.id}`, { method: "DELETE" });
    setDeleting(false);
    setDeleteTarget(null);
    setDeleteCounts(null);
    load();
  }

  async function createProject() {
    if (!name.trim()) return;
    setCreating(true);
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, tagline, purpose, instructions }),
    });
    const data = await res.json();
    setCreating(false);
    setFormOpen(false);
    setName("");
    setTagline("");
    setPurpose("");
    setInstructions("");
    router.refresh();
    router.push(`/projects/${data.project.id}`);
  }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setImporting(true);
    setImportError(null);
    try {
      const text = await file.text();
      const bundle = JSON.parse(text);
      const res = await fetch("/api/projects/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bundle),
      });
      const data = await res.json();
      if (!res.ok) {
        setImportError(data.error ?? "Import failed.");
        setImporting(false);
        return;
      }
      router.refresh();
      router.push(`/projects/${data.project.id}`);
    } catch {
      setImportError("That file isn't valid JSON.");
      setImporting(false);
    }
  }

  async function submitClaudeImport() {
    if (!claudeConversationsFile) return;
    setClaudeImporting(true);
    setClaudeImportError(null);
    setClaudeImportSummary(null);
    const formData = new FormData();
    formData.append("conversations", claudeConversationsFile);
    if (claudeProjectsFile) formData.append("projects", claudeProjectsFile);
    if (claudeMemoriesFile) formData.append("memories", claudeMemoriesFile);
    try {
      const res = await fetch("/api/projects/import/claude-account", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) {
        setClaudeImportError(data.error ?? "Import failed.");
        return;
      }
      setClaudeImportSummary(data.summary);
      setClaudeConversationsFile(null);
      setClaudeProjectsFile(null);
      setClaudeMemoriesFile(null);
      await load();
    } catch {
      setClaudeImportError("Connection interrupted.");
    } finally {
      setClaudeImporting(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-8 py-8">
      <div className="mb-1.5 flex justify-end gap-2">
        <input ref={fileInputRef} type="file" accept="application/json" className="hidden" onChange={handleImportFile} />
        <Button variant="default" onClick={() => fileInputRef.current?.click()} disabled={importing}>
          {importing ? "Importing…" : "Import"}
        </Button>
        <Button variant="default" onClick={() => setClaudeImportOpen((v) => !v)}>
          Import Claude account export
        </Button>
        <Button variant="accent" onClick={() => setFormOpen((v) => !v)}>
          <IconPlus /> New Project
        </Button>
      </div>
      <p className="mb-4 text-right text-[12px] text-[var(--color-text-muted)]">
        Accepts a Magi Project export, or a ChatGPT/Claude <span className="font-technical">conversations.json</span>
        {" "}— extract the .zip first if that&apos;s what you have.
      </p>

      {importError && (
        <div className="mb-4 rounded-[4px] border border-[var(--color-danger)] bg-[var(--color-surface)] px-4 py-3 text-[13px] text-[var(--color-text)]">
          {importError}
        </div>
      )}

      {claudeImportOpen && (
        <Panel className="mb-6 px-5 py-5">
          <div className="mb-4 text-[13px] text-[var(--color-text-muted)]">
            From claude.ai: Settings → Account → Export data. That produces several category .zip files — pick
            the ones you have below. Only the conversations export is required; Projects and memories are each
            optional but add their own Project(s), knowledge documents, and memory.
          </div>
          <div className="mb-4 grid gap-3">
            <div>
              <Label>Conversations export (conversations-000.zip) — required</Label>
              <input
                type="file"
                accept=".zip"
                onChange={(e) => setClaudeConversationsFile(e.target.files?.[0] ?? null)}
                className="text-[13px] text-[var(--color-text-muted)]"
              />
            </div>
            <div>
              <Label>Projects export (projects-000.zip) — optional</Label>
              <input
                type="file"
                accept=".zip"
                onChange={(e) => setClaudeProjectsFile(e.target.files?.[0] ?? null)}
                className="text-[13px] text-[var(--color-text-muted)]"
              />
            </div>
            <div>
              <Label>Memories export (memories-000.zip) — optional</Label>
              <input
                type="file"
                accept=".zip"
                onChange={(e) => setClaudeMemoriesFile(e.target.files?.[0] ?? null)}
                className="text-[13px] text-[var(--color-text-muted)]"
              />
            </div>
          </div>
          {claudeImportError && (
            <div className="mb-3 rounded-[4px] border border-[var(--color-danger)] px-3 py-2 text-[12.5px] text-[var(--color-danger)]">
              {claudeImportError}
            </div>
          )}
          {claudeImportSummary && (
            <div className="mb-3 rounded-[4px] border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2.5 text-[12.5px] text-[var(--color-text-muted)]">
              Imported {claudeImportSummary.projectsCreated} Project(s), {claudeImportSummary.conversationsImported}{" "}
              conversation(s) ({claudeImportSummary.conversationsSkippedEmpty} skipped as empty),{" "}
              {claudeImportSummary.documentsImported} document(s), {claudeImportSummary.artifactsImported}{" "}
              artifact(s), and {claudeImportSummary.memoryItemsImported} memory item(s).
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setClaudeImportOpen(false)}>
              Close
            </Button>
            <Button variant="accent" onClick={submitClaudeImport} disabled={!claudeConversationsFile || claudeImporting}>
              {claudeImporting ? "Importing…" : "Import"}
            </Button>
          </div>
        </Panel>
      )}

      {formOpen && (
        <Panel className="mb-6 px-5 py-5">
          <div className="mb-4 grid gap-3">
            <div>
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Transactional Analysis" autoFocus />
            </div>
            <div>
              <Label>Tagline</Label>
              <Input value={tagline} onChange={(e) => setTagline(e.target.value)} placeholder="One line describing this Project" />
            </div>
            <div>
              <Label>Purpose</Label>
              <Textarea value={purpose} onChange={(e) => setPurpose(e.target.value)} rows={2} placeholder="What this Project is for" />
            </div>
            <div>
              <Label>Instructions</Label>
              <Textarea
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                rows={4}
                placeholder="Role, tone, constraints, terminology — anything Magi should hold in mind for every conversation in this Project"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setFormOpen(false)}>
              Cancel
            </Button>
            <Button variant="accent" onClick={createProject} disabled={!name.trim() || creating}>
              Create Project
            </Button>
          </div>
        </Panel>
      )}

      <div className="mb-4 flex gap-1 border-b border-[var(--color-border)]">
        {(["active", "archived"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`focus-ring border-b-2 px-3 py-2 text-[12.5px] font-medium capitalize transition-colors ${
              statusFilter === s
                ? "border-[var(--color-accent)] text-[var(--color-text)]"
                : "border-transparent text-[var(--color-text-faint)] hover:text-[var(--color-text-muted)]"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {!loading && projects.length === 0 && !formOpen && statusFilter === "active" && (
        <EmptyState
          title="No Projects yet"
          description="Create one, and the details of that work will start accumulating around it."
          action={
            <Button variant="accent" onClick={() => setFormOpen(true)}>
              Create your first Project
            </Button>
          }
        />
      )}
      {!loading && projects.length === 0 && statusFilter === "archived" && (
        <EmptyState title="Nothing archived" description="Projects you archive from the Active tab show up here." />
      )}

      <div className="flex flex-col gap-2">
        {projects.map((p) => {
          const parent = p.parent_project_id ? projects.find((q) => q.id === p.parent_project_id) : null;
          const childCount = projects.filter((q) => q.parent_project_id === p.id).length;
          const moveCandidates = projects.filter((q) => q.id !== p.id && !isDescendantOf(q.id, p.id));
          return (
            <Panel
              key={p.id}
              className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:border-[var(--color-border-strong)]"
            >
              <Link href={`/projects/${p.id}`} className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <div className="truncate text-[14px] font-medium text-[var(--color-text)]">{p.name}</div>
                  {parent && <Tag>Branch of {parent.name}</Tag>}
                  {childCount > 0 && <Tag>{childCount} sub-project{childCount === 1 ? "" : "s"}</Tag>}
                </div>
                {p.tagline && <div className="truncate text-[12.5px] text-[var(--color-text-muted)]">{p.tagline}</div>}
              </Link>

              <div className="flex shrink-0 items-center gap-1">
                <Tag>{new Date(p.updated_at).toLocaleDateString()}</Tag>

                <button
                  onClick={() => togglePin(p)}
                  title={p.pinned ? "Unpin" : "Pin"}
                  className={`focus-ring rounded-[3px] p-1.5 transition-colors ${
                    p.pinned
                      ? "text-[var(--color-accent)]"
                      : "text-[var(--color-text-faint)] hover:text-[var(--color-text)]"
                  }`}
                >
                  <IconPin fill={p.pinned ? "currentColor" : "none"} width={15} height={15} />
                </button>

                {statusFilter === "active" && (
                  <div className="relative">
                    <Button variant="ghost" onClick={() => setMoveOpenFor(moveOpenFor === p.id ? null : p.id)}>
                      Move
                    </Button>
                    {moveOpenFor === p.id && (
                      <div className="absolute right-0 top-full z-20 mt-1 w-56 rounded-[4px] border border-[var(--color-border)] bg-[var(--color-bg-raised)] p-2.5 shadow-lg">
                        <select
                          defaultValue=""
                          onChange={(e) => reparent(p, e.target.value)}
                          className="focus-ring w-full rounded-[3px] border border-[var(--color-border-strong)] bg-[var(--color-bg)] px-2 py-1.5 text-[12.5px] text-[var(--color-text)]"
                        >
                          <option value="" disabled>
                            {parent ? "Change parent…" : "Set parent…"}
                          </option>
                          <option value="">None — stands on its own</option>
                          {moveCandidates.map((q) => (
                            <option key={q.id} value={q.id}>
                              {q.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                )}

                {statusFilter === "active" ? (
                  <Button variant="ghost" onClick={() => setArchived(p, true)}>
                    Archive
                  </Button>
                ) : (
                  <>
                    <Button variant="ghost" onClick={() => setArchived(p, false)}>
                      Restore
                    </Button>
                    <button
                      onClick={() => openDeleteConfirm(p)}
                      title="Delete permanently"
                      className="focus-ring rounded-[3px] p-1.5 text-[var(--color-text-faint)] transition-colors hover:text-[var(--color-danger)]"
                    >
                      <IconTrash width={15} height={15} />
                    </button>
                  </>
                )}
              </div>
            </Panel>
          );
        })}
      </div>

      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-6">
          <Panel className="w-full max-w-md px-5 py-5">
            <div className="mb-2 text-[15px] font-medium text-[var(--color-text)]">
              Delete &ldquo;{deleteTarget.name}&rdquo; permanently?
            </div>
            <p className="mb-3 text-[13px] leading-relaxed text-[var(--color-text-muted)]">
              This can&apos;t be undone. It will permanently delete this Project and everything in it
              {deleteCounts && (
                <>
                  {" "}
                  — {deleteCounts.conversations} conversation{deleteCounts.conversations === 1 ? "" : "s"},{" "}
                  {deleteCounts.documents} document{deleteCounts.documents === 1 ? "" : "s"},{" "}
                  {deleteCounts.artifacts} artifact{deleteCounts.artifacts === 1 ? "" : "s"}, {deleteCounts.memory}{" "}
                  memory item{deleteCounts.memory === 1 ? "" : "s"}, and {deleteCounts.skills} Skill
                  {deleteCounts.skills === 1 ? "" : "s"}
                </>
              )}
              .
            </p>
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                onClick={() => {
                  setDeleteTarget(null);
                  setDeleteCounts(null);
                }}
              >
                Cancel
              </Button>
              <Button variant="danger" onClick={confirmDelete} disabled={deleting}>
                {deleting ? "Deleting…" : "Delete permanently"}
              </Button>
            </div>
          </Panel>
        </div>
      )}
    </div>
  );
}
