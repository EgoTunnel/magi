import { getSkill, type Skill, type SkillStage } from "@/lib/repo/skills";
import { MODEL_ROLES, type ModelRoleId } from "@/lib/models/types";

// Product Vision §39 describes a stack: Skills are methods, Agents are actors
// that use Skills, Councils are groups of actors. In practice those were three
// parallel implementations that shared only the model and tool layers — a
// Skill couldn't say which model it wanted, an Agent's stages were hardcoded,
// and a Council role had no way to reference a Skill at all.
//
// This module is the seam that makes the stack real. Everything that can use a
// Skill resolves it through here, so "what does this Skill actually specify?"
// has one answer rather than three.

export function isModelRole(value: unknown): value is ModelRoleId {
  return typeof value === "string" && MODEL_ROLES.some((r) => r.id === value);
}

export interface ComposedSkill {
  id: string;
  name: string;
  instructions: string;
  // Null when the Skill doesn't care — the caller keeps whatever it had.
  modelRole: ModelRoleId | null;
  allowedTools: string[] | null;
  stages: SkillStage[];
}

export function composeSkill(skillId: string | null | undefined): ComposedSkill | null {
  if (!skillId) return null;
  const skill = getSkill(skillId);
  return skill ? fromSkill(skill) : null;
}

export function fromSkill(skill: Skill): ComposedSkill {
  return {
    id: skill.id,
    name: skill.name,
    instructions: skill.instructions,
    // A stored role that no longer exists (renamed or removed in a later
    // version) degrades to "no preference" rather than to a broken lookup.
    modelRole: isModelRole(skill.model_role) ? skill.model_role : null,
    allowedTools: skill.allowed_tools,
    stages: skill.stages,
  };
}

// Precedence, used everywhere a Skill meets a caller that already had its own
// idea: an explicit choice by the caller always wins, and the Skill fills in
// what the caller left unspecified. A Skill is a default-bearing method, never
// an override of something the user deliberately picked.
export function preferredRole(
  callerRole: ModelRoleId | null | undefined,
  skill: ComposedSkill | null,
  fallback: ModelRoleId
): ModelRoleId {
  if (callerRole) return callerRole;
  if (skill?.modelRole) return skill.modelRole;
  return fallback;
}

// Tool allowlists compose by intersection, never by union — the same posture
// resolveTools() already takes with the global disabled-tools list. A Skill
// can only ever narrow what a caller offers, so referencing a Skill can't
// widen a Council role's or an Agent's permissions.
export function narrowTools(
  callerTools: string[] | null | undefined,
  skillTools: string[] | null | undefined
): string[] | null {
  if (!callerTools) return skillTools ?? null;
  if (!skillTools) return callerTools;
  return callerTools.filter((t) => skillTools.includes(t));
}

// A role's own prompt and a Skill's method are both wanted when both exist:
// the Skill says how to work, the role says who is working. Skill first, since
// the role's own framing should be the last thing the model reads.
export function composeSystemPrompt(skill: ComposedSkill | null, rolePrompt: string | null | undefined): string {
  const parts: string[] = [];
  if (skill) parts.push(`## Method: ${skill.name}\nFollow this method:\n${skill.instructions}`);
  if (rolePrompt?.trim()) parts.push(rolePrompt.trim());
  return parts.join("\n\n");
}
