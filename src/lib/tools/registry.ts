import type { ToolSpec } from "@/lib/models/types";
import { search } from "@/lib/searchIndex";
import { getCrossProjectSearchEnabled, getDisabledTools } from "@/lib/settings";
import { evaluateExpression } from "@/lib/tools/calculator";
import { searchWeb, fetchWebPage } from "@/lib/tools/webSearch";
import { runPython, runJavaScript } from "@/lib/tools/codeExec";
import { saveDocxArtifact, saveXlsxArtifact, savePptxArtifact, saveGeneratedFile } from "@/lib/repo/artifacts";
import { getSkill } from "@/lib/repo/skills";

export interface ToolContext {
  projectId?: string | null;
  conversationId?: string | null;
  allowedToolNames?: Set<string>;
  // create_docx runs mid-stream, before the assistant message it belongs to
  // is persisted — this is how the caller finds out an artifact was created
  // so it can link the two together once a real message id exists. See
  // chat/route.ts.
  onArtifactCreated?: (artifactId: string) => void;
}

// The full set of tools Magi currently offers a model mid-turn — read-only
// archive search, arithmetic, web search/fetch, and sandboxed code execution
// — matching Product Vision §32-33: the model requests a tool, Magi's tool
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
  {
    name: "web_search",
    description:
      "Search the public web for current information — news, facts, documentation, anything outside Magi's own archive. Returns a short list of results with titles, URLs, and snippets. Follow up with web_fetch to read a promising result in full.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search terms" },
        max_results: { type: "number", description: "How many results to return (default 5, max 10)" },
      },
      required: ["query"],
    },
  },
  {
    name: "web_fetch",
    description:
      "Fetch the full text content of a specific web page by URL. Use this after web_search to go deeper on a result, or when the user gives you a URL directly.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "The page URL to fetch" },
      },
      required: ["url"],
    },
  },
  {
    name: "run_python",
    description:
      "Run a Python snippet in a sandboxed interpreter (Pyodide) and return its printed output. Use this for calculations, data analysis, or anything worth verifying by actually running rather than reasoning through by hand. To get a generated file back — a matplotlib chart, a CSV, any file — save it under /output, e.g. plt.savefig('/output/plot.png') or df.to_csv('/output/data.csv'): anything written there is automatically saved as a downloadable artifact in this Project (up to 5 files, 10MB each per run) and reported back to you by title and artifact id. Nothing outside /output survives the run — no network access, and no other real filesystem to read or write. There's no return value channel for computed values: use print() for anything you want back as text. Runs for at most 15 seconds.",
    inputSchema: {
      type: "object",
      properties: {
        code: { type: "string", description: "Python source to execute" },
      },
      required: ["code"],
    },
  },
  {
    name: "run_javascript",
    description:
      "Run a JavaScript snippet in a sandboxed interpreter (QuickJS) and return its console output. Use this for calculations or logic worth verifying by actually running rather than reasoning through by hand. The sandbox has no filesystem, no network access, and no Node/browser globals beyond console.log/console.error — there's no return value channel, so use console.log() for anything you want back. Runs for at most 15 seconds.",
    inputSchema: {
      type: "object",
      properties: {
        code: { type: "string", description: "JavaScript source to execute" },
      },
      required: ["code"],
    },
  },
  {
    name: "create_docx",
    description:
      "Generate a real, properly formatted Word document (.docx) and save it as a downloadable artifact in this Project. Write the content as genuine Markdown — # / ## / ### headings, **bold**, *italic*, - or 1. lists (including nested), GFM tables (| a | b |), [links](url), > blockquotes, and ```fenced code blocks``` — it is converted into actual Word formatting (real heading styles, real list numbering, real tables), not pasted in as literal text. To revise a document already in this Project rather than create a new one, pass its artifact_id — that saves a new version instead of a separate file.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Document title, also used as the filename" },
        markdown: { type: "string", description: "The document's content, written as Markdown" },
        artifact_id: { type: "string", description: "Optional — the id of an existing docx artifact to save a new version of, instead of creating a new one" },
      },
      required: ["title", "markdown"],
    },
  },
  {
    name: "create_xlsx",
    description:
      "Generate a real Excel spreadsheet (.xlsx) and save it as a downloadable artifact in this Project. Write the content as genuine Markdown — # / ## headings, paragraphs, - or 1. lists, and especially GFM tables (| a | b |) — a table becomes real spreadsheet rows with a bold header row, and any cell that's just a plain number is stored as an actual numeric value (not text), so sums/sorts/charts work on it in Excel. Everything else (headings, paragraphs, lists) flows down the same single sheet as plain rows above or below a table, the same way it would in a document. To revise a spreadsheet already in this Project rather than create a new one, pass its artifact_id — that saves a new version instead of a separate file.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Spreadsheet title, also used as the filename and sheet name" },
        markdown: { type: "string", description: "The spreadsheet's content, written as Markdown — put the data in a GFM table" },
        artifact_id: { type: "string", description: "Optional — the id of an existing xlsx artifact to save a new version of, instead of creating a new one" },
      },
      required: ["title", "markdown"],
    },
  },
  {
    name: "create_pptx",
    description:
      "Generate a real PowerPoint presentation (.pptx) and save it as a downloadable artifact in this Project. Write the content as genuine Markdown: each top-level # heading (or a --- on its own line) starts a new slide, using that heading's text as the slide's title. Within a slide, ## / ### become sub-headings, - or 1. lists become real bulleted/numbered lines (nesting supported), GFM tables (| a | b |) become real slide tables with a bold header row, and > blockquotes render as indented italic text. Keep each slide's content reasonably short — a slide is a fixed size, not a scrolling page, and content that would overflow spills onto a plain continuation slide rather than shrinking to fit. To revise a presentation already in this Project rather than create a new one, pass its artifact_id — that saves a new version instead of a separate file.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Presentation title, also used as the filename and the first slide's title" },
        markdown: { type: "string", description: "The presentation's content, written as Markdown — one # heading per slide" },
        artifact_id: { type: "string", description: "Optional — the id of an existing pptx artifact to save a new version of, instead of creating a new one" },
      },
      required: ["title", "markdown"],
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

    if (name === "web_search") {
      const input = rawInput as { query?: string; max_results?: number } | undefined;
      if (!input?.query) return "Error: no query given.";
      return await searchWeb(input.query, input.max_results);
    }

    if (name === "web_fetch") {
      const url = (rawInput as { url?: string } | undefined)?.url;
      if (!url) return "Error: no url given.";
      return await fetchWebPage(url);
    }

    if (name === "run_python") {
      const code = (rawInput as { code?: string } | undefined)?.code;
      if (!code) return "Error: no code given.";
      const result = await runPython(code);
      if (!result.files.length) return result.text;
      if (!ctx.projectId) {
        return `${result.text}\n\n(${result.files.length} file(s) were written to /output but couldn't be saved — no Project context available here.)`;
      }
      const saved = result.files.map((file) => {
        const artifact = saveGeneratedFile({
          projectId: ctx.projectId!,
          conversationId: ctx.conversationId ?? undefined,
          title: file.name,
          bytes: file.bytes,
          mimeType: file.mimeType,
        });
        ctx.onArtifactCreated?.(artifact.id);
        return `${artifact.title} (artifact id ${artifact.id})`;
      });
      return `${result.text}\n\nSaved as artifact(s): ${saved.join(", ")}`;
    }

    if (name === "run_javascript") {
      const code = (rawInput as { code?: string } | undefined)?.code;
      if (!code) return "Error: no code given.";
      return await runJavaScript(code);
    }

    if (name === "create_docx") {
      const input = rawInput as { title?: string; markdown?: string; artifact_id?: string } | undefined;
      if (!input?.title || !input?.markdown) return "Error: title and markdown are both required.";
      if (!ctx.projectId) return "Error: create_docx needs a Project to save into, and none is available here.";
      const artifact = await saveDocxArtifact({
        projectId: ctx.projectId,
        conversationId: ctx.conversationId ?? undefined,
        title: input.title,
        markdown: input.markdown,
        parentId: input.artifact_id,
      });
      ctx.onArtifactCreated?.(artifact.id);
      return `Saved "${artifact.title}" as a Word document (version ${artifact.version}, artifact id ${artifact.id}).`;
    }

    if (name === "create_xlsx") {
      const input = rawInput as { title?: string; markdown?: string; artifact_id?: string } | undefined;
      if (!input?.title || !input?.markdown) return "Error: title and markdown are both required.";
      if (!ctx.projectId) return "Error: create_xlsx needs a Project to save into, and none is available here.";
      const artifact = await saveXlsxArtifact({
        projectId: ctx.projectId,
        conversationId: ctx.conversationId ?? undefined,
        title: input.title,
        markdown: input.markdown,
        parentId: input.artifact_id,
      });
      ctx.onArtifactCreated?.(artifact.id);
      return `Saved "${artifact.title}" as a spreadsheet (version ${artifact.version}, artifact id ${artifact.id}).`;
    }

    if (name === "create_pptx") {
      const input = rawInput as { title?: string; markdown?: string; artifact_id?: string } | undefined;
      if (!input?.title || !input?.markdown) return "Error: title and markdown are both required.";
      if (!ctx.projectId) return "Error: create_pptx needs a Project to save into, and none is available here.";
      const artifact = await savePptxArtifact({
        projectId: ctx.projectId,
        conversationId: ctx.conversationId ?? undefined,
        title: input.title,
        markdown: input.markdown,
        parentId: input.artifact_id,
      });
      ctx.onArtifactCreated?.(artifact.id);
      return `Saved "${artifact.title}" as a presentation (version ${artifact.version}, artifact id ${artifact.id}).`;
    }

    return `Error: unknown tool '${name}'.`;
  } catch (err) {
    return `Error: ${err instanceof Error ? err.message : "tool execution failed"}`;
  }
}
