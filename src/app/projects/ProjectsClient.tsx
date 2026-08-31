"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { Button, EmptyState, Input, Label, Panel, Tag, Textarea } from "@/components/ui";
import { IconPlus } from "@/components/icons";

interface Project {
  id: string;
  name: string;
  tagline: string | null;
  purpose: string | null;
  status: string;
  updated_at: string;
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
  const searchParams = useSearchParams();
  const router = useRouter();
  const [formOpen, setFormOpen] = useState(searchParams.get("new") === "1");

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
    const res = await fetch("/api/projects");
    const data = await res.json();
    setProjects(data.projects);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

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

      {!loading && projects.length === 0 && !formOpen && (
        <EmptyState
          title="No Projects yet"
          description="Create one to give a piece of your work a durable place to live."
          action={
            <Button variant="accent" onClick={() => setFormOpen(true)}>
              Create your first Project
            </Button>
          }
        />
      )}

      <div className="flex flex-col gap-2">
        {projects.map((p) => (
          <Link key={p.id} href={`/projects/${p.id}`}>
            <Panel className="flex items-center justify-between px-4 py-3 transition-colors hover:border-[var(--color-border-strong)]">
              <div>
                <div className="text-[14px] font-medium text-[var(--color-text)]">{p.name}</div>
                {p.tagline && <div className="text-[12.5px] text-[var(--color-text-muted)]">{p.tagline}</div>}
              </div>
              <Tag>{new Date(p.updated_at).toLocaleDateString()}</Tag>
            </Panel>
          </Link>
        ))}
      </div>
    </div>
  );
}
