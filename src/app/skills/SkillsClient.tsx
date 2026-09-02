"use client";

import { useEffect, useState } from "react";
import { Button, EmptyState, Input, Label, Panel, Tag, Textarea } from "@/components/ui";
import { IconPlus, IconTrash } from "@/components/icons";
import { SkillStagesEditor, StageSummary, type SkillStageDraft } from "@/components/SkillStagesEditor";

interface Skill {
  id: string;
  scope: "global" | "project";
  project_id: string | null;
  name: string;
  description: string | null;
  instructions: string;
  allowed_tools: string[] | null;
  model_role: string | null;
  stages: SkillStageDraft[];
}
interface Project {
  id: string;
  name: string;
}
interface ToolInfo {
  name: string;
  description: string;
}
interface RoleInfo {
  id: string;
  label: string;
}

interface StarterSkill {
  name: string;
  description: string;
  instructions: string;
  modelRole?: string;
  stages?: SkillStageDraft[];
}

const STARTER_SKILLS: StarterSkill[] = [
  {
    name: "Research",
    description: "A rigorous research investigation",
    instructions:
      "1. Formulate the precise questions at stake.\n2. Identify what would count as evidence.\n3. Gather and evaluate sources critically — note strength and bias.\n4. Cross-check claims against each other.\n5. Synthesize into a clear position.\n6. Cite what supports each claim.\n7. Flag what remains uncertain rather than smoothing it over.",
    modelRole: "researcher",
    // A worked example of a staged Skill: an Agent given this runs these four
    // stages instead of its built-in pipeline, and only the gathering stage
    // gets tools.
    stages: [
      {
        name: "Frame",
        instructions:
          "State the precise questions at stake and what would count as evidence for each. Do not answer them yet.",
        modelRole: "reasoner",
        useTools: false,
      },
      {
        name: "Gather",
        instructions:
          "Investigate each question. Search the archive and the web where either could plausibly hold relevant material. Report what you find and, explicitly, where you found nothing.",
        modelRole: "researcher",
        useTools: true,
      },
      {
        name: "Cross-check",
        instructions:
          "Test the findings against each other. Note where sources agree, where they conflict, and which claims rest on a single source.",
        modelRole: "critic",
        useTools: false,
      },
      {
        name: "Synthesize",
        instructions:
          "Write the finished position, citing what supports each claim and stating plainly what remains uncertain.",
        modelRole: "synthesizer",
        useTools: false,
      },
    ],
  },
  {
    name: "Writing",
    description: "Develop and revise a piece of writing",
    instructions:
      "1. Establish the purpose and intended reader before drafting.\n2. Develop a structure and check it holds together.\n3. Draft in full rather than polishing fragments.\n4. Critique the draft as a skeptical outside reader would.\n5. Revise for argument, then for clarity, then for rhythm.\n6. Proofread last.",
    modelRole: "writer",
  },
  {
    name: "Historical Research",
    description: "Establish whether a historical claim is defensible",
    instructions:
      "1. Identify primary evidence, not just secondary summaries.\n2. Establish a chronology.\n3. Compare competing interpretations and their assumptions.\n4. Distinguish evidence from inference explicitly.\n5. Produce a sourced synthesis that states its own confidence level.",
    modelRole: "researcher",
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
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [allowedTools, setAllowedTools] = useState<string[] | null>(null);
  const [roles, setRoles] = useState<RoleInfo[]>([]);
  const [modelRole, setModelRole] = useState("");
  const [stages, setStages] = useState<SkillStageDraft[]>([]);
  // Set when the form is editing an existing Skill rather than creating one.
  const [editingId, setEditingId] = useState<string | null>(null);

  async function load() {
    const [skillsRes, projRes, settingsRes, modelsRes] = await Promise.all([
      fetch("/api/skills"),
      fetch("/api/projects"),
      fetch("/api/settings"),
      fetch("/api/models"),
    ]);
    setSkills((await skillsRes.json()).skills);
    const projData = await projRes.json();
    setProjects(projData.projects);
    if (projData.projects.length) setProjectId((p) => p || projData.projects[0].id);
    setTools((await settingsRes.json()).tools ?? []);
    setRoles((await modelsRes.json()).roles ?? []);
  }

  function toggleAllowedTool(name: string) {
    setAllowedTools((prev) => {
      // null means "no restriction" — start narrowing from the full set on
      // the first checkbox interaction rather than from empty.
      const base = prev ?? tools.map((t) => t.name);
      return base.includes(name) ? base.filter((t) => t !== name) : [...base, name];
    });
  }

  useEffect(() => {
    load();
  }, []);

  function resetForm() {
    setName("");
    setDescription("");
    setInstructions("");
    setAllowedTools(null);
    setModelRole("");
    setStages([]);
    setEditingId(null);
    setFormOpen(false);
  }

  async function save() {
    if (!name.trim() || !instructions.trim()) return;
    const payload = {
      name,
      description,
      instructions,
      allowedTools,
      modelRole: modelRole || null,
      // Stages missing a name or instructions can't be run; the server drops
      // them too, but not sending them keeps the two ends agreeing.
      stages: stages.filter((s) => s.name.trim() && s.instructions.trim()),
    };
    if (editingId) {
      await fetch(`/api/skills/${editingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } else {
      await fetch("/api/skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, scope, projectId: scope === "project" ? projectId : undefined }),
      });
    }
    resetForm();
    load();
  }

  function startEdit(s: Skill) {
    setEditingId(s.id);
    setName(s.name);
    setDescription(s.description ?? "");
    setInstructions(s.instructions);
    setAllowedTools(s.allowed_tools);
    setModelRole(s.model_role ?? "");
    setStages(s.stages ?? []);
    setScope(s.scope);
    if (s.project_id) setProjectId(s.project_id);
    setFormOpen(true);
  }

  async function applyStarter(s: (typeof STARTER_SKILLS)[number]) {
    setEditingId(null);
    setName(s.name);
    setDescription(s.description);
    setInstructions(s.instructions);
    setStages(s.stages ?? []);
    setModelRole(s.modelRole ?? "");
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
        <Button
          variant="accent"
          onClick={() => (formOpen ? resetForm() : setFormOpen(true))}
        >
          <IconPlus /> New Skill
        </Button>
      </div>

      {formOpen && (
        <Panel className="mb-6 px-5 py-5">
          {editingId && (
            <div className="mb-3 text-[11px] uppercase tracking-[0.1em] text-[var(--color-text-faint)] font-technical">
              Editing {name}
            </div>
          )}
          <div className="mb-3 flex gap-2">
            <select
              value={scope}
              disabled={!!editingId}
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

          <div className="mb-3">
            <Label>Model role</Label>
            <select
              value={modelRole}
              onChange={(e) => setModelRole(e.target.value)}
              className="focus-ring rounded-[3px] border border-[var(--color-border-strong)] bg-[var(--color-bg)] px-2 py-1.5 text-[13px] text-[var(--color-text)]"
            >
              <option value="">No preference</option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11.5px] leading-relaxed text-[var(--color-text-muted)]">
              Which model this method wants. Used when you haven&apos;t picked a role yourself — an explicit
              choice in the conversation composer, or an Auto turn, still wins.
            </p>
          </div>

          <SkillStagesEditor stages={stages} roles={roles} onChange={setStages} />

          {tools.length > 0 && (
            <div className="mb-3">
              <Label>Tools allowed</Label>
              <div className="flex flex-wrap gap-3">
                {tools.map((t) => (
                  <label key={t.name} className="flex items-center gap-1.5 text-[12.5px] text-[var(--color-text-muted)] font-technical">
                    <input
                      type="checkbox"
                      checked={allowedTools === null || allowedTools.includes(t.name)}
                      onChange={() => toggleAllowedTool(t.name)}
                    />
                    {t.name}
                  </label>
                ))}
              </div>
              <p className="mt-1 text-[11.5px] text-[var(--color-text-muted)]">
                Leave everything checked for no restriction beyond what&apos;s globally enabled in Settings.
              </p>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={resetForm}>
              Cancel
            </Button>
            <Button variant="accent" onClick={save}>
              {editingId ? "Save changes" : "Save Skill"}
            </Button>
          </div>
        </Panel>
      )}

      {skills.length === 0 && !formOpen && (
        <div className="mb-8">
          <EmptyState
            title="No Skills yet"
            description="A Skill bundles instructions, tools, and a whole process into one reusable method. Start from an example:"
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
              <button onClick={() => startEdit(s)} className="min-w-0 text-left">
                <div className="text-[13.5px] font-medium text-[var(--color-text)] transition-colors hover:text-[var(--color-accent)]">
                  {s.name}
                </div>
                {s.description && <div className="text-[12.5px] text-[var(--color-text-muted)]">{s.description}</div>}
                <StageSummary stages={s.stages ?? []} />
              </button>
              <div className="flex shrink-0 items-center gap-2">
                {s.model_role && <Tag>{roles.find((r) => r.id === s.model_role)?.label ?? s.model_role}</Tag>}
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
