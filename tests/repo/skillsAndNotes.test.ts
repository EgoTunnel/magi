import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "../helpers/reset";
import { createProject } from "@/lib/repo/projects";
import { createSkill, deleteSkill, getSkill, listSkills, updateSkill } from "@/lib/repo/skills";
import { composeSkill } from "@/lib/skillComposition";
import {
  clearProposedNotes,
  createProjectNote,
  deleteProjectNote,
  listNotesForClosure,
  listProjectNotes,
  setProjectNoteStatus,
} from "@/lib/repo/projectNotes";

beforeEach(resetDb);

describe("skills repo", () => {
  it("stores a plain Skill with no role and no stages", () => {
    const skill = createSkill({ scope: "global", name: "Plain", instructions: "Do it." });
    expect(skill.model_role).toBeNull();
    expect(skill.stages).toEqual([]);
  });

  it("round-trips a model role and a staged pipeline", () => {
    const skill = createSkill({
      scope: "global",
      name: "Staged",
      instructions: "Method.",
      modelRole: "researcher",
      stages: [
        { name: "One", instructions: "first", modelRole: "reasoner", useTools: false },
        { name: "Two", instructions: "second", modelRole: null, useTools: true },
      ],
    });
    const read = getSkill(skill.id)!;
    expect(read.model_role).toBe("researcher");
    expect(read.stages).toHaveLength(2);
    expect(read.stages[1].useTools).toBe(true);
  });

  it("lets an update clear the role and the stages", () => {
    const skill = createSkill({
      scope: "global",
      name: "Staged",
      instructions: "Method.",
      modelRole: "researcher",
      stages: [{ name: "One", instructions: "first" }],
    });
    const updated = updateSkill(skill.id, { modelRole: null, stages: [] })!;
    expect(updated.model_role).toBeNull();
    expect(updated.stages).toEqual([]);
  });

  it("leaves untouched fields alone on a partial update", () => {
    const skill = createSkill({
      scope: "global",
      name: "Named",
      description: "desc",
      instructions: "Method.",
      modelRole: "critic",
    });
    const updated = updateSkill(skill.id, { name: "Renamed" })!;
    expect(updated.name).toBe("Renamed");
    expect(updated.description).toBe("desc");
    expect(updated.instructions).toBe("Method.");
    expect(updated.model_role).toBe("critic");
  });

  // Regression: a stored role that no longer exists must degrade to "no
  // preference" rather than becoming a broken model lookup.
  it("degrades an unknown model role when composing", () => {
    const skill = createSkill({
      scope: "global",
      name: "Legacy",
      instructions: "x",
      modelRole: "a-role-that-was-removed",
    });
    expect(composeSkill(skill.id)?.modelRole).toBeNull();
  });

  it("resolves a missing Skill to null rather than throwing", () => {
    expect(composeSkill("skl_nope")).toBeNull();
    expect(composeSkill(null)).toBeNull();
  });

  it("scopes project Skills but always includes global ones", () => {
    const a = createProject({ name: "A" });
    const b = createProject({ name: "B" });
    createSkill({ scope: "global", name: "Everywhere", instructions: "x" });
    createSkill({ scope: "project", projectId: a.id, name: "Only A", instructions: "x" });
    createSkill({ scope: "project", projectId: b.id, name: "Only B", instructions: "x" });
    const names = listSkills({ projectId: a.id }).map((s) => s.name);
    expect(names).toContain("Everywhere");
    expect(names).toContain("Only A");
    expect(names).not.toContain("Only B");
  });

  it("deletes", () => {
    const skill = createSkill({ scope: "global", name: "Temp", instructions: "x" });
    deleteSkill(skill.id);
    expect(getSkill(skill.id)).toBeNull();
  });
});

describe("project notes repo", () => {
  it("defaults a drafted note to proposed", () => {
    const project = createProject({ name: "P" });
    const note = createProjectNote({ projectId: project.id, kind: "decision", content: "Ship Friday." });
    expect(note.status).toBe("proposed");
  });

  it("moves a note through its lifecycle", () => {
    const project = createProject({ name: "P" });
    const note = createProjectNote({ projectId: project.id, kind: "question", content: "Who signs off?" });
    expect(setProjectNoteStatus(note.id, "open")?.status).toBe("open");
    expect(setProjectNoteStatus(note.id, "resolved")?.status).toBe("resolved");
    deleteProjectNote(note.id);
    expect(listProjectNotes(project.id)).toHaveLength(0);
  });

  // Regression: redrafting a closing must not silently delete something the
  // user already accepted.
  it("clears proposed notes but spares kept ones", () => {
    const project = createProject({ name: "P" });
    const kept = createProjectNote({
      projectId: project.id,
      kind: "decision",
      content: "kept",
      conversationId: "conv_1",
    });
    createProjectNote({
      projectId: project.id,
      kind: "decision",
      content: "dropped",
      conversationId: "conv_1",
    });
    setProjectNoteStatus(kept.id, "settled");

    clearProposedNotes("conv_1");
    const remaining = listProjectNotes(project.id);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].content).toBe("kept");
  });

  it("filters by status and kind, and groups by closure", () => {
    const project = createProject({ name: "P" });
    createProjectNote({ projectId: project.id, kind: "decision", content: "d", closureId: "epi_1", status: "settled" });
    createProjectNote({ projectId: project.id, kind: "question", content: "q", closureId: "epi_1" });
    expect(listProjectNotes(project.id, { kind: "decision" })).toHaveLength(1);
    expect(listProjectNotes(project.id, { status: ["settled"] })).toHaveLength(1);
    expect(listNotesForClosure("epi_1")).toHaveLength(2);
  });
});
