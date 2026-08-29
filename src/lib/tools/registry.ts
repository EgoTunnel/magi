import type { ToolSpec } from "@/lib/models/types";
import { search } from "@/lib/searchIndex";
import { getCrossProjectSearchEnabled, getDisabledTools } from "@/lib/settings";
import { evaluateExpression } from "@/lib/tools/calculator";
import { getSkill } from "@/lib/repo/skills";

export interface ToolContext {
  projectId?: string | null;
  allowedToolNames?: Set<string>;
}

// The full set of tools Magi currently offers a model mid-turn. This is a
// short, deliberately safe list — read-only archive search and arithmetic —
// matching Product Vision §32-33: the model requests a tool, Magi's tool
// layer is the only thing that actually executes it.
export const TOOL_SPECS: ToolSpec[] = [
  {
    name: "search_archive",
    description:
      "Search Magi's archive of past conversations, Projects, memory, documents, and artifacts by keyword. Use this before claiming you don't know something the user may have already told Magi, or to find prior work relevant to the current question. Set scope to \"all\" to search across every Project — only do that when it's actually relevant to what's being asked, and say so when you use it. Defaults to the current Project.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search terms" },
        scope: {
          type: "string",
          enum: ["this_project", "all"],
          description: "\"this_project\" (default) or \"all\" to search every Project",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "calculator",
    description:
      "Evaluate an arithmetic expression precisely. Supports + - * / ^, parentheses, the functions sqrt/abs/floor/ceil/round/sin/cos/tan/log/ln, and the constants pi and e. Use this for any nontrivial calculation rather than computing by hand.",
    inputSchema: {
      type: "object",
      properties: {
        expression: { type: "string", description: 'e.g. "(3.2 + 7) * sqrt(2)"' },
      },
      required: ["expression"],
    },
  },
];

// The one place that decides which tools a model is actually offered.
// Every caller — conversations, Agents, Councils, Connections — goes through
// this instead of the raw TOOL_SPECS constant, so a global on/off toggle in
// Settings applies everywhere tools are used, not just wherever someone
// remembered to check it. Permissions can only narrow past the global list,
// never widen beyond it: a Skill or Agent-run allowlist that names a
// globally-disabled tool still won't get it.
export function resolveTools(opts: { skillId?: string | null; allowedNames?: string[] | null } = {}): ToolSpec[] {
  const disabled = new Set(getDisabledTools());
  let specs = TOOL_SPECS.filter((t) => !disabled.has(t.name));

  if (opts.skillId) {
    const skill = getSkill(opts.skillId);
    if (skill?.allowed_tools) {
      const allowed = new Set(skill.allowed_tools);
      specs = specs.filter((t) => allowed.has(t.name));
    }
  }
  if (opts.allowedNames) {
    const allowed = new Set(opts.allowedNames);
    specs = specs.filter((t) => allowed.has(t.name));
  }
  return specs;
}

export async function executeTool(name: string, rawInput: unknown, ctx: ToolContext): Promise<string> {
  try {
    if (ctx.allowedToolNames && !ctx.allowedToolNames.has(name)) {
      return `Error: the tool '${name}' is not permitted in this context.`;
    }

    if (name === "calculator") {
      const expr = (rawInput as { expression?: string } | undefined)?.expression;
      if (!expr) return "Error: no expression given.";
      return String(evaluateExpression(expr));
    }

    if (name === "search_archive") {
      const input = rawInput as { query?: string; scope?: string } | undefined;
      const query = input?.query;
      if (!query) return "Error: no query given.";
      const wantsAll = input?.scope === "all";
      const crossProjectAllowed = wantsAll && getCrossProjectSearchEnabled();
      const results = search(query, {
        projectId: crossProjectAllowed ? undefined : ctx.projectId ?? undefined,
        limit: 10,
      });
      if (results.length === 0) {
        return wantsAll && !crossProjectAllowed
          ? "No matches in this Project. Cross-Project search is turned off in Settings, so other Projects were not searched."
          : "No matches found.";
      }
      return results
        .map((r, i) => {
          const elsewhere = r.projectId && r.projectId !== ctx.projectId ? ", from another Project" : "";
          return `[${i + 1}] (${r.kind}${elsewhere}) ${r.title}\n${r.snippet.replace(/⟦|⟧/g, "")}`;
        })
        .join("\n\n");
    }

    return `Error: unknown tool '${name}'.`;
  } catch (err) {
    return `Error: ${err instanceof Error ? err.message : "tool execution failed"}`;
  }
}
