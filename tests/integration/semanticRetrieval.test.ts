import path from "node:path";
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";

// A deterministic stand-in for an embedding model: each word lands in one of a
// few dozen buckets, so texts sharing words point the same way. Enough to
// exercise the semantic half — and its in-memory cache — without a network.
vi.mock("@/lib/models/embeddings", () => {
  const DIMS = 48;
  const embed = (text: string) => {
    const v = new Array(DIMS).fill(0);
    for (const word of text.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 3)) {
      let h = 0;
      for (const c of word) h = (h * 31 + c.charCodeAt(0)) % DIMS;
      v[h] += 1;
    }
    return v;
  };
  return {
    isEmbeddingConfigured: () => true,
    embedTexts: async (_model: string, texts: string[]) => texts.map(embed),
    embedText: async (_model: string, text: string) => embed(text),
  };
});

import { resetDb } from "../helpers/reset";
import { db } from "@/lib/db";
import { createProject } from "@/lib/repo/projects";
import { createDocument } from "@/lib/repo/documents";
import { addMessage, createConversation, deleteConversation, moveConversation } from "@/lib/repo/conversations";
import {
  cachedVectorCount,
  embedChunkRows,
  listUnembeddedChunks,
  resetChunkVectorCache,
  retrieveChunks,
  warmChunkVectorCache,
  worthEmbedding,
} from "@/lib/retrieval";
import { setEmbeddingModelId, setSetting } from "@/lib/settings";

const MODEL = "test/embedder";

beforeEach(() => {
  resetDb();
  setEmbeddingModelId(MODEL);
});

async function embedAll() {
  // Writes queue their own embeddings in the background; let those settle,
  // then fill in anything they missed.
  await new Promise((r) => setTimeout(r, 0));
  await embedChunkRows(listUnembeddedChunks(MODEL), MODEL);
}

const semanticHits = async (query: string, projectId: string) =>
  (await retrieveChunks(query, { projectId })).filter((h) => h.matchedBy !== "keyword");

describe("semantic retrieval from the in-memory vector cache", () => {
  it("finds passages by their vectors", async () => {
    const project = createProject({ name: "P" });
    createDocument(project.id, "Birds", "Peregrine falcons nest on coastal cliffs and hunt pigeons.");
    await embedAll();

    const hits = await semanticHits("where do peregrine falcons nest", project.id);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].title).toBe("Birds");
    expect(hits[0].similarity).toBeGreaterThan(0);
  });

  it("picks up passages embedded after the cache was first loaded", async () => {
    const project = createProject({ name: "P" });
    createDocument(project.id, "Birds", "Peregrine falcons nest on coastal cliffs.");
    await embedAll();
    await retrieveChunks("peregrine falcons coastal cliffs", { projectId: project.id });

    createDocument(project.id, "Fish", "Salmon migrate upstream every autumn to spawn.");
    await embedAll();

    const hits = await semanticHits("salmon migrate upstream spawn", project.id);
    expect(hits.map((h) => h.title)).toContain("Fish");
  });

  it("forgets passages whose source was deleted", async () => {
    const project = createProject({ name: "P" });
    const conversation = createConversation(project.id, "Talk");
    addMessage({ conversationId: conversation.id, role: "user", content: "Kestrels hover above motorway verges hunting voles." });
    await embedAll();
    expect((await semanticHits("kestrels hover hunting voles", project.id)).length).toBeGreaterThan(0);

    deleteConversation(conversation.id);
    expect(await semanticHits("kestrels hover hunting voles", project.id)).toHaveLength(0);
  });

  it("follows a conversation to the Project it was moved to", async () => {
    const from = createProject({ name: "From" });
    const to = createProject({ name: "To" });
    const conversation = createConversation(from.id, "Talk");
    addMessage({ conversationId: conversation.id, role: "user", content: "Ospreys dive feet first to catch trout." });
    await embedAll();
    expect((await semanticHits("ospreys dive catch trout", from.id)).length).toBeGreaterThan(0);

    moveConversation(conversation.id, to.id);
    expect(await semanticHits("ospreys dive catch trout", from.id)).toHaveLength(0);
    expect((await semanticHits("ospreys dive catch trout", to.id)).length).toBeGreaterThan(0);
  });

  it("notices writes made through another connection, such as the MCP server's", async () => {
    const project = createProject({ name: "P" });
    createDocument(project.id, "Birds", "Peregrine falcons nest on coastal cliffs.");
    await embedAll();
    expect((await semanticHits("peregrine falcons coastal cliffs", project.id)).length).toBeGreaterThan(0);

    const other = new Database(path.join(process.env.MAGI_DATA_DIR!, "magi.db"));
    try {
      other.prepare(`UPDATE chunks SET vector = NULL, model = NULL`).run();
    } finally {
      other.close();
    }
    expect(await semanticHits("peregrine falcons coastal cliffs", project.id)).toHaveLength(0);
    // And the database itself agrees, so the cache isn't just empty by luck.
    expect((db.prepare(`SELECT COUNT(*) n FROM chunks WHERE vector IS NOT NULL`).get() as { n: number }).n).toBe(0);
  });
});

describe("warmChunkVectorCache", () => {
  it("loads every stored vector ahead of the first query", async () => {
    const project = createProject({ name: "P" });
    for (let i = 0; i < 5; i++) createDocument(project.id, `Doc ${i}`, `Falcons and kestrels, note number ${i}.`);
    await embedAll();
    const stored = (db.prepare(`SELECT COUNT(*) n FROM chunks WHERE vector IS NOT NULL`).get() as { n: number }).n;

    resetChunkVectorCache();
    expect(cachedVectorCount()).toBeNull();
    await warmChunkVectorCache();
    expect(cachedVectorCount()).toBe(stored);
  });

  it("stands down when there is no embedding model to warm for", async () => {
    setSetting("embedding_model_id", "");
    await warmChunkVectorCache();
    expect(cachedVectorCount()).toBeNull();
  });
});

describe("worthEmbedding", () => {
  it("skips the quick follow-ups that carry nothing to match on meaning", () => {
    for (const q of ["thanks", "ok", "yes please", "shorter please", "keep going", "try again", "go on"]) {
      expect(worthEmbedding(q), q).toBe(false);
    }
  });

  it("embeds anything with real content", () => {
    for (const q of [
      "what did Keith say about pricing",
      "migration schedule",
      "Summarize where the grant application stands",
    ]) {
      expect(worthEmbedding(q), q).toBe(true);
    }
  });
});
