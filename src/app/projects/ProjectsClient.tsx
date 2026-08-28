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

  return (
    <div className="mx-auto max-w-3xl px-8 py-8">
      <div className="mb-4 flex justify-end gap-2">
        <input ref={fileInputRef} type="file" accept="application/json" className="hidden" onChange={handleImportFile} />
        <Button variant="default" onClick={() => fileInputRef.current?.click()} disabled={importing}>
          {importing ? "Importing…" : "Import Project"}
        </Button>
        <Button variant="accent" onClick={() => setFormOpen((v) => !v)}>
          <IconPlus /> New Project
        </Button>
      </div>

      {importError && (
        <div className="mb-4 rounded-[4px] border border-[var(--color-danger)] bg-[var(--color-surface)] px-4 py-3 text-[13px] text-[var(--color-text)]">
          {importError}
        </div>
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
