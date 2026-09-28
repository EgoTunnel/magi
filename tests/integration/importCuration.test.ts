import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { resetDb } from "../helpers/reset";
import { installMockProvider, type MockProvider } from "../helpers/provider";
import { importClaudeAccountExport } from "@/lib/importers/claudeAccountExport";
import {
  applyCuration,
  getCurationStatus,
  listUncuratedImports,
  parseCuration,
  runImportCuration,
} from "@/lib/importCuration";
import { createProject } from "@/lib/repo/projects";
import { createPerson } from "@/lib/repo/people";
import { listMemory } from "@/lib/repo/memory";
import { pruneOrphanedEmbeddings } from "@/lib/embeddingBackfill";
import { indexUpsert, search } from "@/lib/searchIndex";

let mock: MockProvider;

beforeEach(() => {
  resetDb();
  mock = installMockProvider();
});
afterEach(() => mock.restore());

describe("parseCuration", () => {
  it("reads each destination form", () => {
    const claims = parseCuration(
      `thinking out loud, should be discarded\n` +
        `<<<CURATION>>>\n` +
        `GLOBAL :: Prefers density over length.\n` +
        `PROJECT Kestrel :: Retries are capped at 3.\n` +
        `PERSON Keith :: Owns the ingest path.\n` +
        `NEWPROJECT Baseline :: Generates PDF reports.\n` +
        `DROP duplicate :: restates the summary above\n` +
        `<<<END>>>\n` +
        `GLOBAL :: this is outside the markers and must not count`
    );
    expect(claims).toEqual([
      { destination: "global", target: null, claim: "Prefers density over length." },
      { destination: "project", target: "Kestrel", claim: "Retries are capped at 3." },
      { destination: "person", target: "Keith", claim: "Owns the ingest path." },
      { destination: "newproject", target: "Baseline", claim: "Generates PDF reports." },
      { destination: "drop", target: "duplicate", claim: "restates the summary above" },
    ]);
  });

  it("tolerates a leading bullet and skips lines it cannot read", () => {
    const claims = parseCuration(
      `<<<CURATION>>>\n- GLOBAL :: kept\nHere is some commentary.\nPROJECT :: no target, dropped\n\nGLOBAL ::\n<<<END>>>`
    );
    expect(claims).toEqual([{ destination: "global", target: null, claim: "kept" }]);
  });
});

describe("applyCuration", () => {
  it("routes claims and lands every one as suggested", () => {
    const project = createProject({ name: "Kestrel" });
    const keith = createPerson({ name: "Keith" });

    const outcome = applyCuration("mem_source", [
      { destination: "global", target: null, claim: "Prefers density over length." },
      { destination: "project", target: "kestrel", claim: "Retries are capped at 3." },
      { destination: "person", target: "Keith", claim: "Owns the ingest path." },
      { destination: "drop", target: "duplicate", claim: "restates the summary" },
    ]);

    expect(outcome.kept).toBe(3);
    expect(outcome.dropped).toBe(1);
    // Nothing a machine re-filed is established: it is inert until a human
    // keeps it, which is the whole reason this is safe to run automatically.
    expect(outcome.created.every((m) => m.status === "suggested")).toBe(true);

    const globalItems = listMemory({ scope: "global" });
    expect(globalItems).toHaveLength(1);
    expect(globalItems[0].content).toBe("Prefers density over length.");

    const projectItems = listMemory({ projectId: project.id }).filter((m) => m.scope === "project");
    expect(projectItems).toHaveLength(1);
    expect(projectItems[0].project_id).toBe(project.id);

    const personItems = listMemory({ personId: keith.id });
    expect(personItems).toHaveLength(1);
    expect(personItems[0].content).toBe("Owns the ingest path.");
  });

  it("reports a person it cannot resolve instead of inventing them", () => {
    const outcome = applyCuration("mem_source", [
      { destination: "person", target: "Keith Brannigan", claim: "Owns the ingest path." },
    ]);
    expect(outcome.kept).toBe(0);
    expect(outcome.unresolved).toEqual([{ target: "Keith Brannigan", claim: "Owns the ingest path." }]);
    expect(listMemory({}).length).toBe(0);
  });

  it("keeps a claim that wants a Project which does not exist, and names the Project", () => {
    const outcome = applyCuration("mem_source", [
      { destination: "newproject", target: "Baseline", claim: "Generates PDF reports." },
      { destination: "newproject", target: "Baseline", claim: "Never persists student data." },
    ]);
    // Creating a Project unasked is not this pass's call, but losing the claim
    // would be worse than filing it loosely.
    expect(outcome.proposedProjects).toEqual([
      { name: "Baseline", claims: ["Generates PDF reports.", "Never persists student data."] },
    ]);
    const globals = listMemory({ scope: "global" });
    expect(globals).toHaveLength(2);
    expect(globals.every((m) => m.status === "suggested")).toBe(true);
    expect(globals[0].source).toContain('wants Project "Baseline"');
  });

  it("routes a NEWPROJECT claim to the real Project once one exists by that name", () => {
    const project = createProject({ name: "Baseline" });
    const outcome = applyCuration("mem_source", [
      { destination: "newproject", target: "baseline", claim: "Generates PDF reports." },
    ]);
    expect(outcome.proposedProjects).toEqual([]);
    expect(listMemory({ projectId: project.id }).filter((m) => m.scope === "project")).toHaveLength(1);
  });
});

describe("runImportCuration", () => {
  // The shape a real Claude account export ships: one account-wide summary and
  // one blob per memory file, each written verbatim as global established
  // memory by the importer.
  function seedImport() {
    importClaudeAccountExport({
      conversations: [],
      projects: [{ uuid: "u1", name: "Kestrel", description: "the review pipeline" }],
      memory: {
        conversations_memory: "Andrew is a consultant. He is building Kestrel. He prefers density over length.",
        memory_files: [
          {
            path: "baseline.md",
            content:
              "---\nname: baseline\nsources: [backfill]\n---\n- [stated] Developing Baseline\n- [stated] Generates PDF reports",
          },
        ],
      },
    });
  }

  it("finds the rows an importer wrote verbatim, and leaves Project-scoped ones alone", () => {
    seedImport();
    const pending = listUncuratedImports();
    // The account summary and the memory file — but not the Kestrel project
    // memory, which the importer already filed correctly.
    expect(pending).toHaveLength(2);
    expect(pending.every((p) => !p.content.includes("Kestrel project memory"))).toBe(true);
  });

  it("re-files each block, supersedes the original, and records what it proposed", async () => {
    seedImport();
    mock.setDefaultReply(
      `<<<CURATION>>>\n` +
        `GLOBAL :: Prefers density over length.\n` +
        `PROJECT Kestrel :: The review pipeline replaced a nightly batch job.\n` +
        `NEWPROJECT Baseline :: Generates PDF reports.\n` +
        `DROP narrative summary :: restates other claims\n` +
        `<<<END>>>`
    );

    const status = await runImportCuration();
    expect(status.status).toBe("complete");
    expect(status.total).toBe(2);
    expect(status.processed).toBe(2);
    expect(status.kept).toBe(6);
    expect(status.dropped).toBe(2);
    expect(status.proposedProjects).toEqual([
      { name: "Baseline", claims: ["Generates PDF reports.", "Generates PDF reports."] },
    ]);

    // The originals are inert but still readable — superseded, not deleted.
    const originals = db
      .prepare(`SELECT status FROM memory WHERE source = 'import' AND scope = 'global'`)
      .all() as Array<{ status: string }>;
    expect(originals).toHaveLength(2);
    expect(originals.every((r) => r.status === "superseded")).toBe(true);

    // Nothing the pass produced is established, so the prompt is unchanged
    // until the user reviews it on the Memory page.
    const established = listMemory({ scope: "global" }).filter((m) => m.status === "established");
    expect(established).toHaveLength(0);

    // A suggestion is not in the archive yet, so it must not be searchable.
    expect(search("density over length").length).toBe(0);
  });

  it("is a no-op when there is nothing left to curate", async () => {
    const status = await runImportCuration();
    expect(status.status).toBe("complete");
    expect(status.total).toBe(0);
    expect(mock.calls).toHaveLength(0);
  });

  it("keeps what it finished when a later block fails", async () => {
    seedImport();
    // failNext() is checked before the reply queue, so it would sink the first
    // call rather than the second. A counting default reply is how you say
    // "succeed once, then fail".
    let calls = 0;
    mock.setDefaultReply(() => {
      calls++;
      if (calls > 1) throw new Error("provider exploded");
      return `<<<CURATION>>>\nGLOBAL :: Prefers density over length.\n<<<END>>>`;
    });

    const status = await runImportCuration();
    expect(status.status).toBe("error");
    expect(status.error).toContain("provider exploded");
    expect(status.processed).toBe(1);
    // The first block is done and superseded; the second is untouched and will
    // be picked up by the next run.
    expect(listUncuratedImports()).toHaveLength(1);
    expect(getCurationStatus().status).toBe("error");
  });
});

describe("pruneOrphanedEmbeddings", () => {
  it("removes vectors and passages whose indexed item is gone", () => {
    const project = createProject({ name: "Kestrel" });
    indexUpsert({
      kind: "document",
      refId: "doc_gone",
      projectId: project.id,
      title: "Deleted doc",
      content: "The queue was removed because bursts no longer happen.",
      skipEmbedding: true,
    });
    // A vector for an item whose search_index row is later removed by
    // something that did not go through indexRemove().
    db.prepare(
      `INSERT INTO embeddings (kind, ref_id, project_id, model, title, snippet, vector, updated_at)
       VALUES ('document', 'doc_gone', ?, 'm', 'Deleted doc', 'snippet', X'00000000', '2026-01-01')`
    ).run(project.id);
    db.prepare(`DELETE FROM search_index WHERE ref_id = 'doc_gone'`).run();

    const n = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
    expect(n(`SELECT COUNT(*) n FROM embeddings WHERE ref_id = 'doc_gone'`)).toBe(1);
    expect(n(`SELECT COUNT(*) n FROM chunks WHERE ref_id = 'doc_gone'`)).toBeGreaterThan(0);

    const removed = pruneOrphanedEmbeddings();

    expect(removed).toBeGreaterThan(0);
    expect(n(`SELECT COUNT(*) n FROM embeddings WHERE ref_id = 'doc_gone'`)).toBe(0);
    expect(n(`SELECT COUNT(*) n FROM chunks WHERE ref_id = 'doc_gone'`)).toBe(0);
    // The FTS mirror has to go with them, or the passage comes back as a
    // keyword hit for content that no longer exists.
    expect(n(`SELECT COUNT(*) n FROM chunk_search`)).toBe(0);
  });

  it("leaves a live item's vectors and passages alone", () => {
    const project = createProject({ name: "Kestrel" });
    indexUpsert({
      kind: "document",
      refId: "doc_live",
      projectId: project.id,
      title: "Live doc",
      content: "Still here, and still indexed.",
      skipEmbedding: true,
    });
    const before = (db.prepare(`SELECT COUNT(*) n FROM chunks`).get() as { n: number }).n;
    expect(pruneOrphanedEmbeddings()).toBe(0);
    expect((db.prepare(`SELECT COUNT(*) n FROM chunks`).get() as { n: number }).n).toBe(before);
  });
});
