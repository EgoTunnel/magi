import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { resetDb } from "../helpers/reset";
import { createProject } from "@/lib/repo/projects";
import { createDocument } from "@/lib/repo/documents";
import { createMemory, listMemory } from "@/lib/repo/memory";
import { addPersonFact, associate, createPerson } from "@/lib/repo/people";

// Drives the real MCP server the way a coding agent would: a separate process,
// spoken to over stdio with the protocol's own client. Nothing here imports the
// server module — a test that called its handlers directly would prove the
// functions work while saying nothing about whether the server starts, resolves
// "@/" outside Next, or can open the same SQLite file the app has open.
//
// The subprocess is pointed at this file's temp MAGI_DATA_DIR (tests/setup.ts),
// so it reads the rows seeded below. That two processes can share the database
// at all is the WAL pragma in src/lib/db.ts.

let client: Client;
let projectId: string;

beforeAll(async () => {
  resetDb();

  const project = createProject({
    name: "Kestrel",
    tagline: "the review pipeline",
    purpose: "Replace the nightly batch reviewer with something interactive.",
    instructions: "Prefer boring, obvious code. No new dependencies without a written reason.",
  });
  projectId = project.id;

  createDocument(
    projectId,
    "Queue removal",
    "We dropped the job queue in favour of synchronous handling. The queue was only ever " +
      "absorbing bursts we no longer get, and it made every failure a two-hop debugging problem."
  );
  createMemory({ scope: "project", projectId, content: "Retries are capped at 3.", status: "established" });
  createMemory({ scope: "project", projectId, content: "Maybe move to Postgres.", status: "suggested" });
  createMemory({ scope: "global", content: "Andrew writes his own commit messages.", status: "established" });

  const keith = createPerson({ name: "Keith", relationship: "reviewer on Kestrel" });
  addPersonFact({ personId: keith.id, content: "Owns the ingest path and wants to review changes to it." });
  associate(projectId, keith.id, "reviewer", { status: "established" });

  client = new Client({ name: "magi-test", version: "0.0.0" });
  await client.connect(
    new StdioClientTransport({
      // node + tsx's CLI directly, rather than the npm script: no shell, no
      // .cmd shim, and identical on every platform the suite runs on.
      command: process.execPath,
      args: [path.resolve("node_modules/tsx/dist/cli.mjs"), path.resolve("src/mcp/server.ts")],
      env: { ...process.env, MAGI_PROJECT_ID: projectId } as Record<string, string>,
    })
  );
}, 60_000);

afterAll(async () => {
  // Before tests/setup.ts closes the database and deletes the directory:
  // Windows won't unlink a file another process still has open.
  await client?.close();
});

async function callText(name: string, args: Record<string, unknown> = {}): Promise<string> {
  const result = (await client.callTool({ name, arguments: args })) as {
    content: Array<{ type: string; text?: string }>;
    isError?: boolean;
  };
  return result.content.map((c) => c.text ?? "").join("\n");
}

describe("magi mcp server", () => {
  it("advertises the archive tools", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "list_projects",
      "lookup_person",
      "project_context",
      "search_archive",
      "suggest_memory",
      "trace_thinking",
    ]);
    // A coding agent decides whether to ask before it decides what to ask, so
    // every read tool has to declare itself as one.
    const search = tools.find((t) => t.name === "search_archive");
    expect(search?.annotations?.readOnlyHint).toBe(true);
    expect(tools.find((t) => t.name === "suggest_memory")?.annotations?.readOnlyHint).toBe(false);
  });

  it("searches the archive of the Project it was started for", async () => {
    const out = await callText("search_archive", { query: "why did we drop the job queue" });
    expect(out).toContain("Queue removal");
    expect(out).toContain("synchronous");
  });

  it("returns Project instructions and established memory, and withholds suggestions", async () => {
    const out = await callText("project_context");
    expect(out).toContain("Kestrel");
    expect(out).toContain("No new dependencies without a written reason");
    expect(out).toContain("Retries are capped at 3.");
    expect(out).toContain("Andrew writes his own commit messages.");
    // The deliberate-memory rule holds across the seam: a suggestion is inert
    // for an outside agent exactly as it is for Magi's own prompts.
    expect(out).not.toContain("Maybe move to Postgres");
  });

  it("looks a person up by name", async () => {
    const out = await callText("lookup_person", { name: "Keith" });
    expect(out).toContain("reviewer on Kestrel");
    expect(out).toContain("Owns the ingest path");
  });

  it("names the recorded people rather than guessing at a near miss", async () => {
    const out = await callText("lookup_person", { name: "Keith Brannigan" });
    expect(out).toContain("No one named");
    expect(out).toContain("Keith");
  });

  it("lists Projects with their purpose", async () => {
    const out = await callText("list_projects");
    expect(out).toContain("Kestrel");
    expect(out).toContain("Replace the nightly batch reviewer");
    expect(out).toContain(projectId);
  });

  it("resolves a Project by name as well as by id", async () => {
    const out = await callText("project_context", { project: "kestrel" });
    expect(out).toContain("Prefer boring, obvious code");
  });

  it("reports an unknown Project instead of silently widening the scope", async () => {
    const result = (await client.callTool({
      name: "search_archive",
      arguments: { query: "queue", project: "Nonexistent" },
    })) as { isError?: boolean; content: Array<{ text?: string }> };
    expect(result.isError).toBe(true);
    expect(result.content.map((c) => c.text ?? "").join("")).toContain("No Project matches");
  });

  it("writes a proposal that lands as suggested, not established", async () => {
    const out = await callText("suggest_memory", {
      content: "The ingest path is deliberately single-threaded.",
      source: "claude code / kestrel repo",
    });
    expect(out).toContain("Proposed for the user's review");

    const written = listMemory({ projectId }).find((m) =>
      m.content.includes("deliberately single-threaded")
    );
    expect(written).toBeDefined();
    expect(written?.status).toBe("suggested");
    expect(written?.source).toContain("mcp:");
    expect(written?.project_id).toBe(projectId);
  });

  it("keeps a proposal out of search until a human keeps it", async () => {
    const out = await callText("search_archive", { query: "single-threaded ingest path" });
    expect(out).not.toContain("deliberately single-threaded");
  });
});
