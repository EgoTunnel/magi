"use client";

import { useEffect, useState } from "react";
import { Button, EmptyState, Label, Panel, Tag, Textarea } from "@/components/ui";
import { IconPlus, IconTrash } from "@/components/icons";

interface MemoryItem {
  id: string;
  scope: "global" | "project";
  project_id: string | null;
  content: string;
  source: string | null;
  created_at: string;
}
interface Project {
  id: string;
  name: string;
}

export function MemoryClient() {
  const [items, setItems] = useState<MemoryItem[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [content, setContent] = useState("");
  const [scope, setScope] = useState<"global" | "project">("global");
  const [projectId, setProjectId] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");

  async function load() {
    const [memRes, projRes] = await Promise.all([fetch("/api/memory"), fetch("/api/projects")]);
    setItems((await memRes.json()).memory);
    const projData = await projRes.json();
    setProjects(projData.projects);
    if (projData.projects.length) setProjectId((p) => p || projData.projects[0].id);
  }

  useEffect(() => {
    load();
  }, []);

  async function create() {
    if (!content.trim()) return;
    await fetch("/api/memory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope, projectId: scope === "project" ? projectId : undefined, content }),
    });
    setContent("");
    setFormOpen(false);
    load();
  }

  async function remove(id: string) {
    await fetch(`/api/memory/${id}`, { method: "DELETE" });
    load();
  }

  async function saveEdit(id: string) {
    await fetch(`/api/memory/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: editDraft }),
    });
    setEditingId(null);
    load();
  }

  const globalItems = items.filter((i) => i.scope === "global");
  const projectItems = items.filter((i) => i.scope === "project");
  const projectName = (id: string | null) => projects.find((p) => p.id === id)?.name ?? "Unknown Project";

  return (
    <div className="mx-auto max-w-3xl px-8 py-8">
      <div className="mb-5 flex justify-end">
        <Button variant="accent" onClick={() => setFormOpen((v) => !v)}>
          <IconPlus /> Add memory
        </Button>
      </div>

      {formOpen && (
        <Panel className="mb-6 px-5 py-5">
          <Label>Scope</Label>
          <div className="mb-3 flex gap-2">
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value as "global" | "project")}
              className="focus-ring rounded-[3px] border border-[var(--color-border-strong)] bg-[var(--color-bg)] px-2 py-1.5 text-[13px] text-[var(--color-text)]"
            >
              <option value="global">Global</option>
              <option value="project">Project</option>
            </select>
            {scope === "project" && (
              <select
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                className="focus-ring rounded-[3px] border border-[var(--color-border-strong)] bg-[var(--color-bg)] px-2 py-1.5 text-[13px] text-[var(--color-text)]"
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
          </div>
          <Label>Content</Label>
          <Textarea value={content} onChange={(e) => setContent(e.target.value)} rows={3} placeholder="A fact worth retaining deliberately" />
          <div className="mt-3 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setFormOpen(false)}>
              Cancel
            </Button>
            <Button variant="accent" onClick={create}>
              Save
            </Button>
          </div>
        </Panel>
      )}

      <section className="mb-8">
        <h2 className="mb-2.5 text-[13px] font-semibold uppercase tracking-[0.1em] text-[var(--color-text-faint)] font-technical">
          Global memory
        </h2>
        {globalItems.length === 0 ? (
          <EmptyState title="Nothing here yet" description="Global memory applies to every Project — persistent preferences, recurring goals, stable instructions." />
        ) : (
          <div className="flex flex-col gap-1.5">
            {globalItems.map((item) => (
              <MemoryRow
                key={item.id}
                item={item}
                editing={editingId === item.id}
                editDraft={editDraft}
                onEditStart={() => {
                  setEditingId(item.id);
                  setEditDraft(item.content);
                }}
                onEditChange={setEditDraft}
                onEditSave={() => saveEdit(item.id)}
                onEditCancel={() => setEditingId(null)}
                onRemove={() => remove(item.id)}
              />
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-2.5 text-[13px] font-semibold uppercase tracking-[0.1em] text-[var(--color-text-faint)] font-technical">
          Project memory
        </h2>
        {projectItems.length === 0 ? (
          <EmptyState title="Nothing here yet" description="Project memory is established knowledge specific to one Project — decisions, terminology, conclusions." />
        ) : (
          <div className="flex flex-col gap-1.5">
            {projectItems.map((item) => (
              <MemoryRow
                key={item.id}
                item={item}
                label={projectName(item.project_id)}
                editing={editingId === item.id}
                editDraft={editDraft}
                onEditStart={() => {
                  setEditingId(item.id);
                  setEditDraft(item.content);
                }}
                onEditChange={setEditDraft}
                onEditSave={() => saveEdit(item.id)}
                onEditCancel={() => setEditingId(null)}
                onRemove={() => remove(item.id)}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function MemoryRow({
  item,
  label,
  editing,
  editDraft,
  onEditStart,
  onEditChange,
  onEditSave,
  onEditCancel,
  onRemove,
}: {
  item: MemoryItem;
  label?: string;
  editing: boolean;
  editDraft: string;
  onEditStart: () => void;
  onEditChange: (v: string) => void;
  onEditSave: () => void;
  onEditCancel: () => void;
  onRemove: () => void;
}) {
  return (
    <Panel className="px-4 py-3">
      {editing ? (
        <div>
          <Textarea value={editDraft} onChange={(e) => onEditChange(e.target.value)} rows={3} />
          <div className="mt-2 flex justify-end gap-2">
            <Button variant="ghost" onClick={onEditCancel}>
              Cancel
            </Button>
            <Button variant="accent" onClick={onEditSave}>
              Save
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-start justify-between gap-3">
          <button onClick={onEditStart} className="text-left text-[13px] leading-relaxed text-[var(--color-text)] hover:text-[var(--color-accent)] transition-colors">
            {item.content}
          </button>
          <div className="flex shrink-0 items-center gap-2">
            {label && <Tag>{label}</Tag>}
            <button onClick={onRemove} className="focus-ring text-[var(--color-text-faint)] hover:text-[var(--color-danger)]">
              <IconTrash />
            </button>
          </div>
        </div>
      )}
    </Panel>
  );
}
