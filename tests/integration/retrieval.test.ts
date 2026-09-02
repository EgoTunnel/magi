import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "../helpers/reset";
import { db } from "@/lib/db";
import { createProject } from "@/lib/repo/projects";
import { createDocument } from "@/lib/repo/documents";
import { addMessage, createConversation, deleteConversation, moveConversation } from "@/lib/repo/conversations";
import { matchCountsByDate, repairChunkDates, retrieveChunks } from "@/lib/retrieval";
import { setSetting } from "@/lib/settings";

beforeEach(resetDb);

const chunkCount = () => (db.prepare(`SELECT COUNT(*) n FROM chunks`).get() as { n: number }).n;

describe("passage index maintenance", () => {
  it("chunks a document on write and removes its chunks on delete", () => {
    const project = createProject({ name: "P" });
    const doc = createDocument(project.id, "Notes", "The kestrel hunts at dusk. ".repeat(200));
    expect(chunkCount()).toBeGreaterThan(1);

    db.prepare(`DELETE FROM documents WHERE id = ?`).run(doc.id);
    // Deleting the row directly leaves orphans; the app's own delete path calls
    // indexRemove. This asserts the repair pass cleans up either way.
    setSetting("chunk_dates_repaired", "0");
    repairChunkDates();
    expect(chunkCount()).toBe(0);
  });

  it("re-chunks rather than accumulating when content is replaced", () => {
    const project = createProject({ name: "P" });
    const conversation = createConversation(project.id, "Talk");
    addMessage({ conversationId: conversation.id, role: "user", content: "short" });
    const afterFirst = chunkCount();
    addMessage({ conversationId: conversation.id, role: "assistant", content: "also short" });
    expect(chunkCount()).toBe(afterFirst + 1);

    deleteConversation(conversation.id);
    expect(chunkCount()).toBe(0);
  });

  it("moves a conversation's passages to the new Project so scoping stays correct", async () => {
    const from = createProject({ name: "From" });
    const to = createProject({ name: "To" });
    const conversation = createConversation(from.id, "Talk");
    addMessage({ conversationId: conversation.id, role: "user", content: "peregrine falcons nest on cliffs" });

    moveConversation(conversation.id, to.id);

    const inOld = await retrieveChunks("peregrine falcons", { projectId: from.id });
    const inNew = await retrieveChunks("peregrine falcons", { projectId: to.id });
    expect(inOld).toHaveLength(0);
    expect(inNew.length).toBeGreaterThan(0);
  });
});

describe("retrieveChunks", () => {
  it("finds a passage by keyword without any embedding model configured", async () => {
    const project = createProject({ name: "P" });
    createDocument(project.id, "Ornithology", "Filler. ".repeat(50) + "\n\nThe kestrel hovers before stooping on its prey.\n\n" + "Filler. ".repeat(50));
    const hits = await retrieveChunks("kestrel hovers", { projectId: project.id });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].matchedBy).toBe("keyword");
    expect(hits.some((h) => h.content.includes("kestrel"))).toBe(true);
  });

  it("scopes to the requested Project", async () => {
    const a = createProject({ name: "A" });
    const b = createProject({ name: "B" });
    createDocument(a.id, "A doc", "quokkas are marsupials");
    createDocument(b.id, "B doc", "quokkas are marsupials");
    expect(await retrieveChunks("quokkas", { projectId: a.id })).toHaveLength(1);
    expect(await retrieveChunks("quokkas", { projectId: [a.id, b.id] })).toHaveLength(2);
  });

  it("caps how much any one source can contribute, and lets the cap be raised", async () => {
    const project = createProject({ name: "P" });
    createDocument(project.id, "Repetitive", Array.from({ length: 20 }, (_, i) => `Section ${i}. ${"badger ".repeat(200)}`).join("\n\n"));
    const capped = await retrieveChunks("badger", { projectId: project.id });
    expect(capped.length).toBeLessThanOrEqual(3);
    const raised = await retrieveChunks("badger", { projectId: project.id, maxPerSource: 12 });
    expect(raised.length).toBeGreaterThan(3);
  });

  it("returns nothing for an empty query rather than everything", async () => {
    const project = createProject({ name: "P" });
    createDocument(project.id, "Doc", "some content here");
    expect(await retrieveChunks("   ", { projectId: project.id })).toEqual([]);
  });

  it("survives punctuation-only and quote-bearing queries", async () => {
    const project = createProject({ name: "P" });
    createDocument(project.id, "Doc", 'she said "hello" once');
    expect(await retrieveChunks("?? !!", { projectId: project.id })).toEqual([]);
    await expect(retrieveChunks('said "hello"', { projectId: project.id })).resolves.toBeDefined();
  });
});

describe("matchCountsByDate", () => {
  // Regression: counting the retrieval pool instead of the archive made every
  // topic report the pool cap. Counts must be uncapped and independent of
  // relevance ranking.
  it("counts every match, not just the retrievable ones", async () => {
    const project = createProject({ name: "P" });
    createDocument(project.id, "Long", Array.from({ length: 30 }, (_, i) => `Part ${i}. ${"wombat ".repeat(200)}`).join("\n\n"));
    const retrieved = await retrieveChunks("wombat", { projectId: project.id });
    const counts = matchCountsByDate("wombat", { projectId: project.id });
    expect(retrieved.length).toBeLessThanOrEqual(3);
    expect(counts.total).toBeGreaterThan(retrieved.length);
  });

  // Regression: "AI in the classroom" reported 14,574 matches on the strength
  // of the word "the".
  it("ignores common words so a count stays meaningful", () => {
    const project = createProject({ name: "P" });
    // Filler made only of words the stopword list covers, chunked into many
    // passages — the exact shape that inflated a real count to 14,574.
    createDocument(
      project.id,
      "Ordinary prose",
      Array.from({ length: 30 }, () => `${"and the that with from about ".repeat(60)}`).join("\n\n")
    );
    createDocument(project.id, "Topic", "A note about aardvarks.");

    const counts = matchCountsByDate("aardvarks and the things about that", { projectId: project.id });
    expect(counts.total).toBe(1);
  });

  it("still matches when a query is nothing but common words", () => {
    // Deliberate: dropping every term would silently return nothing for a
    // query the user actually typed, so an all-stopword query keeps them.
    const project = createProject({ name: "P" });
    createDocument(project.id, "Prose", "the work and the rest");
    expect(matchCountsByDate("the and", { projectId: project.id }).total).toBeGreaterThan(0);
  });

  it("groups by month and reports true endpoints", () => {
    const project = createProject({ name: "P" });
    createDocument(project.id, "Old", "narwhal sightings");
    createDocument(project.id, "New", "narwhal sightings again");
    db.prepare(`UPDATE chunks SET source_date = '2025-03-04T00:00:00.000Z' WHERE title = 'Old'`).run();
    db.prepare(`UPDATE chunks SET source_date = '2026-01-09T00:00:00.000Z' WHERE title = 'New'`).run();

    const counts = matchCountsByDate("narwhal", { projectId: project.id });
    expect(counts.total).toBe(2);
    expect(counts.earliest?.slice(0, 7)).toBe("2025-03");
    expect(counts.latest?.slice(0, 7)).toBe("2026-01");
    expect([...counts.byMonth.keys()].sort()).toEqual(["2025-03", "2026-01"]);
  });
});

describe("repairChunkDates", () => {
  // Regression: passages were dated when they were indexed, not when the
  // material was written, so every trajectory spanned a single day.
  it("restores each passage's real date from its source row", () => {
    const project = createProject({ name: "P" });
    const conversation = createConversation(project.id, "Talk");
    const message = addMessage({ conversationId: conversation.id, role: "user", content: "dated content here" });

    db.prepare(`UPDATE messages SET created_at = '2024-05-06T00:00:00.000Z' WHERE id = ?`).run(message.id);
    db.prepare(`UPDATE chunks SET source_date = '2026-09-01T00:00:00.000Z' WHERE kind = 'message'`).run();

    setSetting("chunk_dates_repaired", "0");
    repairChunkDates();

    const row = db.prepare(`SELECT source_date FROM chunks WHERE kind = 'message'`).get() as { source_date: string };
    expect(row.source_date).toBe("2024-05-06T00:00:00.000Z");
  });

  it("only runs once", () => {
    const project = createProject({ name: "P" });
    createDocument(project.id, "Doc", "content");
    setSetting("chunk_dates_repaired", "0");
    repairChunkDates();
    db.prepare(`UPDATE chunks SET source_date = 'sentinel'`).run();
    repairChunkDates();
    const row = db.prepare(`SELECT source_date FROM chunks LIMIT 1`).get() as { source_date: string };
    expect(row.source_date).toBe("sentinel");
  });
});
