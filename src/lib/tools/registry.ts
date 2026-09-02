import type { ToolSpec } from "@/lib/models/types";
import { search, semanticSearch, type SearchResult } from "@/lib/searchIndex";
import { ensureChunkIndex, retrieveChunks } from "@/lib/retrieval";
import { traceTrajectory, trajectoryDigest } from "@/lib/trajectory";
import { getCrossProjectSearchEnabled, getDisabledTools, getEmbeddingModelId, getOpenRouterApiKey } from "@/lib/settings";
import { evaluateExpression } from "@/lib/tools/calculator";
import { searchWeb, fetchWebPage } from "@/lib/tools/webSearch";
import { runPython, runJavaScript } from "@/lib/tools/codeExec";
import { saveDocxArtifact, saveXlsxArtifact, savePptxArtifact, saveGeneratedFile } from "@/lib/repo/artifacts";
import { getSkill } from "@/lib/repo/skills";
import { listPeople, lookupPerson } from "@/lib/repo/people";
import { getProject, listAncestorProjects, familyProjectIds } from "@/lib/repo/projects";
import { projectTheme } from "@/lib/files/theme";

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
      "Search Magi's archive of past conversations, Projects, memory, documents, and artifacts. Matches on meaning as well as exact wording, and returns real passages of the matching material, not one-line snippets — so a natural-language question works better here than a bag of keywords. Use this before claiming you don't know something the user may have already told Magi, or to find prior work relevant to the current question. Defaults to the current Project ONLY. If the question or objective names a different Project, references work that plausibly lives elsewhere, or asks you to search \"across Projects\" — set scope to \"all\" immediately; don't assume the current Project's own results are all there is just because a same-scoped search came back empty or thin. Say so when you use cross-Project scope.",
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
    name: "trace_thinking",
    description:
      "Trace how a topic developed over time in the user's own archive. Returns the same material search_archive would find, but organized as a timeline: when it first appears, how often it came up in each period, and representative passages from each. Use this — not search_archive — whenever the question is about time or change: \"when did I first think about X\", \"how has my view of X changed\", \"have I always believed X\", \"what was I working on last spring\". Report what the dates actually show, including when they show the thinking was stable rather than developing.",
    inputSchema: {
      type: "object",
      properties: {
        topic: { type: "string", description: "The topic to trace, in natural language" },
        scope: {
          type: "string",
          enum: ["this_project", "all"],
          description: "\"all\" (default) traces across every Project, which is usually what a question about time wants; \"this_project\" restricts it",
        },
      },
      required: ["topic"],
    },
  },
  {
    name: "lookup_person",
    description:
      "Look up one of the people the user works with — a colleague, client, collaborator, or family member they have recorded in Magi. Returns how they relate to the user, what the user has deliberately recorded about them (each fact dated), which Projects they are on, and the most relevant places they are mentioned in the archive. Use this whenever a named person comes up and what you know about them matters: before saying anything about who someone is, what they care about, or what was agreed with them. It returns only what the user actually recorded — if it finds nothing, say so rather than inferring the person from surrounding context.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "The person's name, exactly as the user writes it. Aliases the user has recorded also match.",
        },
      },
      required: ["name"],
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

function themeForProject(projectId: string) {
  const project = getProject(projectId);
  if (!project) return undefined;
  // Nearest-ancestor-first, so a branch's own brand guide wins over its
  // parent's wherever the branch actually sets a field, and only falls
  // through to inherited values it leaves blank.
  const ancestors = listAncestorProjects(projectId).reverse();
  return projectTheme([project, ...ancestors]);
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
      // Not "all": search this Project's whole hierarchy branch — itself,
      // every ancestor it inherits context from, and every descendant a
      // meta-project's members live in — not just the one row's own id.
      const scopeProjectId = crossProjectAllowed ? undefined : ctx.projectId ? familyProjectIds(ctx.projectId) : undefined;

      // Passage retrieval: real extracts of the matching material rather than
      // a 24-token keyword window around the hit, and hybrid, so a question
      // phrased differently than the archive's own wording still lands. This
      // is the same machinery context assembly uses (src/lib/retrieval.ts).
      ensureChunkIndex();
      const passages = await retrieveChunks(query, { projectId: scopeProjectId, limit: 8 }).catch(() => []);
      if (passages.length) {
        return passages
          .map((p, i) => {
            const elsewhere = p.projectId && p.projectId !== ctx.projectId ? ", from another Project" : "";
            const kind = p.kind === "style_guide" ? "style guide" : p.kind;
            return `[${i + 1}] (${kind}${elsewhere}, ${p.sourceDate.slice(0, 10)}) ${p.title}\n${p.content}`;
          })
          .join("\n\n");
      }

      // Nothing in the passage index matched — fall back to the whole-item
      // keyword index, which still covers rows too short to have produced a
      // passage (a conversation title, a one-line memory item).
      let results: SearchResult[] = search(query, { projectId: scopeProjectId, limit: 10 });
      let matchedByMeaning = false;
      if (results.length === 0 && getEmbeddingModelId() && getOpenRouterApiKey()) {
        try {
          const semanticResults = await semanticSearch(query, { projectId: scopeProjectId, limit: 10 });
          if (semanticResults.length) {
            results = semanticResults;
            matchedByMeaning = true;
          }
        } catch {
          // Fall through to "No matches found" below.
        }
      }
      if (results.length === 0) {
        return wantsAll && !crossProjectAllowed
          ? "No matches in this Project. Cross-Project search is turned off in Settings, so other Projects were not searched."
          : "No matches found.";
      }
      const header = matchedByMeaning ? "(matched by meaning/topic, not exact wording)\n\n" : "";
      return (
        header +
        results
          .map((r, i) => {
            const elsewhere = r.projectId && r.projectId !== ctx.projectId ? ", from another Project" : "";
            return `[${i + 1}] (${r.kind}${elsewhere}) ${r.title}\n${r.snippet.replace(/⟦|⟧/g, "")}`;
          })
          .join("\n\n")
      );
    }

    if (name === "lookup_person") {
      const who = (rawInput as { name?: string } | undefined)?.name;
      if (!who) return "Error: no name given.";
      ensureChunkIndex();
      const found = await lookupPerson(who);
      if (!found) {
        // Naming who *is* known is the difference between a dead end and a
        // usable answer — and it is also the guard against the model deciding
        // that a near-miss must be the same human. Matching is exact by
        // design; the model is told plainly that it is.
        const known = listPeople({ status: "established" }).map((p) => p.name);
        if (!known.length) return `No one named "${who}" is recorded, and no people have been recorded yet.`;
        return (
          `No one named "${who}" is recorded. Names are matched exactly (including recorded aliases) — do not ` +
          `assume a similar name is the same person. Recorded people: ${known.slice(0, 40).join(", ")}` +
          (known.length > 40 ? `, and ${known.length - 40} more.` : ".")
        );
      }

      const lines = [`${found.person.name}${found.person.relationship ? ` — ${found.person.relationship}` : ""}`];
      if (found.person.aliases.length) lines.push(`Also known as: ${found.person.aliases.join(", ")}`);
      if (found.person.summary) lines.push(found.person.summary);
      if (found.projects.length) lines.push(`\nProjects: ${found.projects.map((p) => p.name).join(", ")}`);

      lines.push(
        found.facts.length
          ? `\nWhat the user has recorded about them:\n` +
              found.facts.map((f) => `- (${f.created_at.slice(0, 10)}) ${f.content}`).join("\n")
          : `\nThe user has not recorded any facts about them yet.`
      );
      if (found.mentions.length) {
        lines.push(
          `\nMentioned in:\n` +
            found.mentions
              .map((m) => `- (${m.sourceDate.slice(0, 10)}) ${m.title}\n  ${m.content.replace(/\s+/g, " ").slice(0, 400)}`)
              .join("\n")
        );
      }
      return lines.join("\n");
    }

    if (name === "trace_thinking") {
      const input = rawInput as { topic?: string; scope?: string } | undefined;
      const topic = input?.topic;
      if (!topic) return "Error: no topic given.";
      // Unlike search_archive, this defaults to every Project: a question
      // about how thinking developed is rarely bounded by where the thinking
      // happened to be filed. The cross-Project setting still governs it.
      const restrict = input?.scope === "this_project" || !getCrossProjectSearchEnabled();
      const scopeProjectId = restrict && ctx.projectId ? familyProjectIds(ctx.projectId) : undefined;

      const trajectory = await traceTrajectory(topic, { projectId: scopeProjectId });
      if (trajectory.totalPassages === 0) return "Nothing in the archive touches on this topic.";

      const header =
        `${trajectory.totalPassages} passages about "${topic}", from ` +
        `${trajectory.firstDate?.slice(0, 10)} to ${trajectory.lastDate?.slice(0, 10)} ` +
        `(${trajectory.spanDays} days).\n` +
        (restrict ? "Scope: this Project and its hierarchy.\n" : "Scope: every Project.\n");
      return `${header}\n${trajectoryDigest(trajectory)}`;
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
        theme: themeForProject(ctx.projectId),
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
        theme: themeForProject(ctx.projectId),
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
        theme: themeForProject(ctx.projectId),
      });
      ctx.onArtifactCreated?.(artifact.id);
      return `Saved "${artifact.title}" as a presentation (version ${artifact.version}, artifact id ${artifact.id}).`;
    }

    return `Error: unknown tool '${name}'.`;
  } catch (err) {
    return `Error: ${err instanceof Error ? err.message : "tool execution failed"}`;
  }
}
