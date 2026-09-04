import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { describePerson, searchArchive, traceThinking } from "@/lib/knowledgeTools";
import { createMemory, listMemory } from "@/lib/repo/memory";
import { getProject, listAncestorProjects, listProjects, type Project } from "@/lib/repo/projects";

// Magi as an MCP server: the archive, the People record, and Project standing
// context, offered over stdio to whatever coding agent is running in a repo.
//
// The division of labour is the point. Magi owns intent, decisions, knowledge,
// people, and the record; the coding tool owns the working tree. Nothing here
// reads or writes a repository — it answers "what did I decide about X" and
// "who is Keith" with the same material Magi's own conversations get, and
// takes proposals back the same way closing an episode does.
//
// Transport is stdio only, on purpose. A stdio server is a child process on
// this machine talking to its parent over a pipe: no port, no origin, no
// token, no surface to authenticate. The moment this grows an HTTP transport
// for editors that can't spawn a subprocess, it needs a local API token
// first — that is a separate piece of work, not a flag to add here.
//
// Run it with `npm run mcp`, from the repo root (see package.json). The
// database is the same data/magi.db the app uses; SQLite is in WAL mode, so
// this process and `next dev` can both have it open.

// Which Project the caller is working in, when they don't name one per call.
// The intended setup is one MCP server entry per repository, each pinned to
// the Project that repository belongs to — so a coding agent in that repo asks
// questions in the right context without having to know Project ids exist.
const DEFAULT_PROJECT = process.env.MAGI_PROJECT_ID ?? null;

// Accepts an id or a name, because a model that has just read list_projects
// will reach for whichever it found more memorable, and being strict here buys
// nothing. Returns null for "no Project", which is a valid scope (the whole
// archive), and throws only when the caller named something that doesn't exist
// — a silent fallback to the whole archive would look like a working search
// that quietly ignored the scope it was given.
function resolveProjectId(named?: string): string | null {
  const wanted = named ?? DEFAULT_PROJECT;
  if (!wanted) return null;
  if (getProject(wanted)) return wanted;
  const all = [...listProjects({ status: "active" }), ...listProjects({ status: "archived" })];
  const match = all.find((p) => p.name.toLowerCase() === wanted.toLowerCase());
  if (match) return match.id;
  throw new Error(
    `No Project matches "${wanted}". Call list_projects to see what exists, or pass no project to search the whole archive.`
  );
}

function text(body: string) {
  return { content: [{ type: "text" as const, text: body }] };
}

const server = new McpServer(
  { name: "magi", version: "0.1.0" },
  {
    instructions:
      "Magi is this user's own archive: their past conversations, the Projects they organize work into, the " +
      "decisions and knowledge they have deliberately kept, and the people they work with. Consult it before " +
      "assuming something is unknown or unspecified — a requirement, a naming convention, a rejected approach, " +
      "or who someone is may already be recorded here. It knows nothing about the current repository's files; " +
      "read those with your own tools.",
  }
);

const scopeArg = z
  .enum(["this_project", "all"])
  .optional()
  .describe('"this_project" keeps to the Project and its hierarchy; "all" searches every Project');

const projectArg = z
  .string()
  .optional()
  .describe("Project id or name. Defaults to the Project this server was started for, if any.");

server.registerTool(
  "search_archive",
  {
    title: "Search the archive",
    description:
      "Search the user's archive of past conversations, Projects, memory, documents, and artifacts. Matches on " +
      "meaning as well as exact wording and returns real passages, so a natural-language question works better " +
      "than a bag of keywords. Use this before treating a requirement, convention, or past decision as " +
      "unspecified — the reasoning behind the code you are working on often lives here rather than in the repo.",
    inputSchema: {
      query: z.string().describe("A natural-language question or topic"),
      scope: scopeArg,
      project: projectArg,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ query, scope, project }) => {
    const projectId = resolveProjectId(project);
    // No Project in play at all means there is nothing to be "outside" of, so
    // the honest scope is everything rather than an empty result.
    return text(await searchArchive(query, { projectId, scope: projectId ? scope : "all" }));
  }
);

server.registerTool(
  "trace_thinking",
  {
    title: "Trace how thinking developed",
    description:
      "Trace how a topic developed over time in the user's archive: when it first appears, how often it came up " +
      "in each period, and representative passages from each. Use this instead of search_archive whenever the " +
      "question is about time or change — \"when did we decide to drop the queue\", \"has this always been the " +
      "plan\", \"what was the thinking before this refactor\". Report what the dates show, including when they " +
      "show a position was stable rather than evolving.",
    inputSchema: {
      topic: z.string().describe("The topic to trace, in natural language"),
      scope: scopeArg,
      project: projectArg,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ topic, scope, project }) => {
    const projectId = resolveProjectId(project);
    return text(await traceThinking(topic, { projectId, scope }));
  }
);

server.registerTool(
  "lookup_person",
  {
    title: "Look up a person",
    description:
      "Look up someone the user works with — a colleague, client, collaborator, or family member they have " +
      "recorded in Magi. Returns how they relate to the user, the dated facts the user has deliberately " +
      "recorded, which Projects they are on, and where they come up in the archive. Use this whenever a named " +
      "person matters to what you are doing: a reviewer, a code owner, whoever asked for the change. It returns " +
      "only what was actually recorded — if it finds nothing, say so rather than inferring from context.",
    inputSchema: {
      name: z
        .string()
        .describe("The person's name as the user writes it. Recorded aliases also match; matching is exact."),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ name }) => text(await describePerson(name))
);

server.registerTool(
  "list_projects",
  {
    title: "List Projects",
    description:
      "List the user's Projects — the standing contexts they organize work into — with each one's purpose. Use " +
      "this to find the right Project to scope a search to when you don't already know it.",
    inputSchema: {
      include_archived: z.boolean().optional().describe("Include archived Projects (default false)"),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ include_archived }) => {
    const projects = [
      ...listProjects({ status: "active" }),
      ...(include_archived ? listProjects({ status: "archived" }) : []),
    ];
    if (!projects.length) return text("No Projects exist yet.");
    const lines = projects.map((p) => {
      const bits = [`${p.name} (id ${p.id})${p.status === "archived" ? " [archived]" : ""}`];
      if (p.tagline) bits.push(`  ${p.tagline}`);
      if (p.purpose) bits.push(`  Purpose: ${p.purpose.replace(/\s+/g, " ").slice(0, 300)}`);
      return bits.join("\n");
    });
    const note = DEFAULT_PROJECT
      ? `\n\nThis server defaults to Project "${DEFAULT_PROJECT}".`
      : "\n\nThis server has no default Project; pass `project` to scope a search.";
    return text(lines.join("\n") + note);
  }
);

server.registerTool(
  "project_context",
  {
    title: "Get a Project's standing context",
    description:
      "Get the standing context for a Project: its purpose, the instructions the user has set for work in it " +
      "(including any inherited from parent Projects), and the established knowledge recorded against it. This " +
      "is the user's own account of what the work is for and how they want it done. Read it before starting " +
      "substantial work in a repository that belongs to a Project.",
    inputSchema: { project: projectArg },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ project }) => {
    const projectId = resolveProjectId(project);
    if (!projectId) {
      return text("No Project specified and this server has no default. Call list_projects, then pass `project`.");
    }
    const found = getProject(projectId);
    if (!found) return text(`Project ${projectId} no longer exists.`);

    const sections: string[] = [];
    const describe = (p: Project, label: string) => {
      sections.push(`## ${label}: ${p.name}${p.tagline ? ` — ${p.tagline}` : ""}`);
      if (p.purpose) sections.push(`Purpose: ${p.purpose}`);
      if (p.instructions) sections.push(`${label} instructions (these override general preferences):\n${p.instructions}`);
    };
    // Root-first, so inherited instructions read before the ones that narrow
    // them — the same order the app's own system prompt uses.
    for (const ancestor of listAncestorProjects(projectId)) describe(ancestor, "Parent Project");
    describe(found, "Project");

    // Only 'established' items. A suggestion is inert everywhere until a human
    // keeps it, and an MCP client is not the human — see repo/memory.ts.
    const global = listMemory({ scope: "global" }).filter((m) => m.status === "established");
    const scoped = listMemory({ projectId }).filter((m) => m.status === "established" && m.scope === "project");
    const line = (m: { created_at: string; content: string }) => `- (${m.created_at.slice(0, 10)}) ${m.content}`;
    if (global.length) sections.push(`\n## Global memory (applies everywhere)\n${global.map(line).join("\n")}`);
    if (scoped.length) sections.push(`\n## Project memory (established knowledge)\n${scoped.map(line).join("\n")}`);

    return text(sections.join("\n"));
  }
);

server.registerTool(
  "suggest_memory",
  {
    title: "Propose something worth recording",
    description:
      "Propose a decision, constraint, or piece of knowledge for the user to keep in Magi — for example a " +
      "choice made during this coding session that the archive would otherwise never learn about. It is saved " +
      "as a SUGGESTION and does nothing until the user reviews and keeps it: it does not enter search, does not " +
      "reach any prompt, and is not a way to write to the user's record directly. Propose sparingly, one claim " +
      "per call, written as a standalone statement that will still make sense in a year — not a summary of what " +
      "you just did. Tell the user when you have proposed something.",
    inputSchema: {
      content: z
        .string()
        .describe("The claim, as one standalone statement (e.g. \"Retries are capped at 3 because the upstream API rate-limits above that\")"),
      project: projectArg,
      source: z
        .string()
        .optional()
        .describe("Where this came from, e.g. the coding tool and repository you are working in"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  async ({ content, project, source }) => {
    const trimmed = content.trim();
    if (!trimmed) return text("Error: no content given.");
    const projectId = resolveProjectId(project);
    const item = createMemory({
      scope: projectId ? "project" : "global",
      projectId: projectId ?? undefined,
      content: trimmed,
      // Provenance the user will actually see on the Memory page. Whatever the
      // client passes is untrusted text, so it is length-capped and folded to
      // one line rather than stored as given.
      source: `mcp: ${(source ?? "external coding agent").replace(/\s+/g, " ").slice(0, 120)}`,
      status: "suggested",
    });
    return text(
      `Proposed for the user's review (id ${item.id})${projectId ? ` in Project ${projectId}` : " as global memory"}. ` +
        `It is inert until they keep it — tell them it is waiting on Magi's Memory page.`
    );
  }
);

async function main() {
  // stdout is the protocol channel: anything written there that isn't a JSON-RPC
  // message corrupts the stream, so diagnostics go to stderr.
  await server.connect(new StdioServerTransport());
  console.error(
    `magi mcp server ready (project: ${DEFAULT_PROJECT ?? "none"}, data: ${process.env.MAGI_DATA_DIR ?? "./data"})`
  );
}

main().catch((err) => {
  console.error("magi mcp server failed to start:", err);
  process.exit(1);
});
