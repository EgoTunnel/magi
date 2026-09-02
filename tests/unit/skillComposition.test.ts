import { describe, expect, it } from "vitest";
import {
  composeSystemPrompt,
  isModelRole,
  narrowTools,
  preferredRole,
  type ComposedSkill,
} from "@/lib/skillComposition";

const skill = (over: Partial<ComposedSkill> = {}): ComposedSkill => ({
  id: "s",
  name: "Method",
  instructions: "Do it carefully.",
  modelRole: "critic",
  allowedTools: null,
  stages: [],
  ...over,
});

describe("preferredRole", () => {
  it("lets an explicit caller choice win over the Skill", () => {
    expect(preferredRole("writer", skill(), "default")).toBe("writer");
  });

  it("uses the Skill's role when the caller has no preference", () => {
    expect(preferredRole(null, skill(), "default")).toBe("critic");
  });

  it("falls back when neither the caller nor the Skill states one", () => {
    expect(preferredRole(null, skill({ modelRole: null }), "researcher")).toBe("researcher");
    expect(preferredRole(null, null, "researcher")).toBe("researcher");
  });
});

describe("narrowTools", () => {
  it("composes by intersection", () => {
    expect(narrowTools(["a", "b", "c"], ["b", "c", "d"])).toEqual(["b", "c"]);
  });

  // The security-relevant property: referencing a Skill must never grant a
  // caller a tool it wasn't already allowed.
  it("cannot widen what the caller allowed", () => {
    expect(narrowTools(["a"], ["a", "b", "c"])).toEqual(["a"]);
  });

  it("treats null as 'no restriction' on either side", () => {
    expect(narrowTools(null, null)).toBeNull();
    expect(narrowTools(["a", "b"], null)).toEqual(["a", "b"]);
    expect(narrowTools(null, ["a", "b"])).toEqual(["a", "b"]);
  });

  it("yields an empty allowlist when the two disagree entirely", () => {
    expect(narrowTools(["a"], ["b"])).toEqual([]);
  });
});

describe("composeSystemPrompt", () => {
  it("puts the method first and the role's own framing last", () => {
    const prompt = composeSystemPrompt(skill(), "You are the Skeptic.");
    expect(prompt.indexOf("Method")).toBeLessThan(prompt.indexOf("Skeptic"));
  });

  it("works with either half alone", () => {
    expect(composeSystemPrompt(skill(), "")).toContain("Do it carefully.");
    expect(composeSystemPrompt(null, "You are the Skeptic.")).toBe("You are the Skeptic.");
    expect(composeSystemPrompt(null, "")).toBe("");
  });
});

describe("isModelRole", () => {
  it("accepts real roles and rejects everything else", () => {
    expect(isModelRole("critic")).toBe(true);
    expect(isModelRole("default")).toBe(true);
    expect(isModelRole("not-a-role")).toBe(false);
    expect(isModelRole(null)).toBe(false);
    expect(isModelRole(undefined)).toBe(false);
  });
});
