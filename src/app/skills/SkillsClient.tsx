"use client";

import { useEffect, useState } from "react";
import { Button, EmptyState, Input, Label, Panel, Tag, Textarea } from "@/components/ui";
import { IconPlus, IconTrash } from "@/components/icons";

interface Skill {
  id: string;
  scope: "global" | "project";
  project_id: string | null;
  name: string;
  description: string | null;
  instructions: string;
}
interface Project {
  id: string;
  name: string;
}

const STARTER_SKILLS = [
  {
    name: "Research",
    description: "A rigorous research investigation",
    instructions:
      "1. Formulate the precise questions at stake.\n2. Identify what would count as evidence.\n3. Gather and evaluate sources critically — note strength and bias.\n4. Cross-check claims against each other.\n5. Synthesize into a clear position.\n6. Cite what supports each claim.\n7. Flag what remains uncertain rather than smoothing it over.",
  },
  {
    name: "Writing",
    description: "Develop and revise a piece of writing",
    instructions:
      "1. Establish the purpose and intended reader before drafting.\n2. Develop a structure and check it holds together.\n3. Draft in full rather than polishing fragments.\n4. Critique the draft as a skeptical outside reader would.\n5. Revise for argument, then for clarity, then for rhythm.\n6. Proofread last.",
  },
  {
    name: "Historical Research",
    description: "Establish whether a historical claim is defensible",
    instructions:
      "1. Identify primary evidence, not just secondary summaries.\n2. Establish a chronology.\n3. Compare competing interpretations and their assumptions.\n4. Distinguish evidence from inference explicitly.\n5. Produce a sourced synthesis that states its own confidence level.",
  },
];

export function SkillsClient() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [scope, setScope] = useState<"global" | "project">("global");
  const [projectId, setProjectId] = useState("");

  async function load() {
    const [skillsRes, projRes] = await Promise.all([fetch("/api/skills"), fetch("/api/projects")]);
    setSkills((await skillsRes.json()).skills);
    const projData = await projRes.json();
    setProjects(projData.projects);
    if (projData.projects.length) setProjectId((p) => p || projData.projects[0].id);
  }

  useEffect(() => {
    load();
  }, []);

  async function create() {
    if (!name.trim() || !instructions.trim()) return;
    await fetch("/api/skills", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scope,
        projectId: scope === "project" ? projectId : undefined,
        name,
        description,
        instructions,
      }),
    });
    setName("");
    setDescription("");
    setInstructions("");
    setFormOpen(false);
    load();
  }

  async function applyStarter(s: (typeof STARTER_SKILLS)[number]) {
    setName(s.name);
    setDescription(s.description);
    setInstructions(s.instructions);
    setFormOpen(true);
  }

  async function remove(id: string) {
    await fetch(`/api/skills/${id}`, { method: "DELETE" });
    load();
  }

  const projectName = (id: string | null) => projects.find((p) => p.id === id)?.name ?? "Unknown Project";

  return (
    <div className="mx-auto max-w-2xl px-8 py-8">
      <div className="mb-5 flex justify-end">
        <Button variant="accent" onClick={() => setFormOpen((v) => !v)}>
          <IconPlus /> New Skill
        </Button>
      </div>

      {formOpen && (
        <Panel className="mb-6 px-5 py-5">
          <div className="mb-3 flex gap-2">
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value as "global" | "project")}
              className="focus-ring rounded-[3px] border border-[var(--color-border-strong)] bg-[var(--color-bg)] px-2 py-1.5 text-[13px] text-[var(--color-text)]"
            >
              <option value="global">Global</option>
              <option value="project">Project-specific</option>
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
          <Label>Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} className="mb-3" placeholder="e.g. Literature Review" />
          <Label>Description</Label>
          <Input value={description} onChange={(e) => setDescription(e.target.value)} className="mb-3" placeholder="One line" />
          <Label>Method</Label>
          <Textarea
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            rows={6}
            className="mb-3"
            placeholder={"1. First step\n2. Second step\n…"}
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setFormOpen(false)}>
              Cancel
            </Button>
            <Button variant="accent" onClick={create}>
              Save Skill
            </Button>
          </div>
        </Panel>
      )}

      {skills.length === 0 && !formOpen && (
        <div className="mb-8">
          <EmptyState
            title="No Skills yet"
            description="A Skill is a reusable method — not just a tool, a whole process. Start from an example:"
          />
          <div className="mt-3 flex flex-wrap gap-2">
            {STARTER_SKILLS.map((s) => (
              <Button key={s.name} variant="default" onClick={() => applyStarter(s)}>
                {s.name}
              </Button>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        {skills.map((s) => (
          <Panel key={s.id} className="px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[13.5px] font-medium text-[var(--color-text)]">{s.name}</div>
                {s.description && <div className="text-[12.5px] text-[var(--color-text-muted)]">{s.description}</div>}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Tag>{s.scope === "project" ? projectName(s.project_id) : "Global"}</Tag>
                <button onClick={() => remove(s.id)} className="focus-ring text-[var(--color-text-faint)] hover:text-[var(--color-danger)]">
                  <IconTrash />
                </button>
              </div>
            </div>
          </Panel>
        ))}
      </div>
    </div>
  );
}
