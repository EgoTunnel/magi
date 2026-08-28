import type { ToolSpec } from "@/lib/models/types";
import { search } from "@/lib/searchIndex";
import { getCrossProjectSearchEnabled } from "@/lib/settings";
import { evaluateExpression } from "@/lib/tools/calculator";

export interface ToolContext {
  projectId?: string | null;
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

export async function executeTool(name: string, rawInput: unknown, ctx: ToolContext): Promise<string> {
  try {
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
