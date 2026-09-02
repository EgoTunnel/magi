import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "../helpers/reset";
import { db } from "@/lib/db";
import { createProject } from "@/lib/repo/projects";
import { addMessage, createConversation } from "@/lib/repo/conversations";
import { createMemory, listMemory, setMemoryStatus } from "@/lib/repo/memory";
import {
  addPersonFact,
  associate,
  createPerson,
  deletePerson,
  dissociate,
  exportPerson,
  findPersonByName,
  getPerson,
  listPeople,
  listPeopleForProject,
  listPersonFacts,
  listPersonMentions,
  listProjectRoster,
  listProjectsForPerson,
  lookupPerson,
  mergePeople,
  setAssociationStatus,
  setPersonStatus,
  updatePerson,
} from "@/lib/repo/people";

beforeEach(resetDb);

const indexRows = (kind: string, refId: string) =>
  (db.prepare(`SELECT COUNT(*) n FROM search_index WHERE kind = ? AND ref_id = ?`).get(kind, refId) as { n: number }).n;
const chunkRows = (kind: string, refId: string) =>
  (db.prepare(`SELECT COUNT(*) n FROM chunks WHERE kind = ? AND ref_id = ?`).get(kind, refId) as { n: number }).n;

describe("people repo", () => {
  it("round-trips a person with aliases, updates, and deletes", () => {
    const person = createPerson({ name: "Keith", relationship: "client contact at Acme", aliases: ["K. Bell"] });
    expect(person.status).toBe("established");
    expect(person.aliases).toEqual(["K. Bell"]);
    expect(getPerson(person.id)?.name).toBe("Keith");

    const updated = updatePerson(person.id, { summary: "Runs the review process.", aliases: ["K. Bell", "Keith Bell"] });
    expect(updated?.summary).toBe("Runs the review process.");
    expect(updated?.aliases).toEqual(["K. Bell", "Keith Bell"]);

    deletePerson(person.id);
    expect(getPerson(person.id)).toBeNull();
    expect(listPeople()).toHaveLength(0);
  });

  it("matches a name or an exact alias, and nothing else", () => {
    const person = createPerson({ name: "Keith", aliases: ["K. Bell"] });
    expect(findPersonByName("keith")?.id).toBe(person.id);
    expect(findPersonByName("K. BELL")?.id).toBe(person.id);
    // No fuzzy matching, ever — a near-miss is a different human until the user
    // says otherwise.
    expect(findPersonByName("Keith Bell")).toBeNull();
    expect(findPersonByName("Kieth")).toBeNull();
  });

  it("indexes an established person and never a suggested one", () => {
    const suggested = createPerson({ name: "Marta", status: "suggested", relationship: "collaborator" });
    expect(indexRows("person", suggested.id)).toBe(0);
    expect(chunkRows("person", suggested.id)).toBe(0);

    setPersonStatus(suggested.id, "established");
    expect(indexRows("person", suggested.id)).toBe(1);
    expect(chunkRows("person", suggested.id)).toBeGreaterThan(0);

    setPersonStatus(suggested.id, "suggested");
    expect(indexRows("person", suggested.id)).toBe(0);
  });

  // The deleteConversation class of bug: delete the parent first and the query
  // that was meant to find the children for unindexing returns nothing, leaving
  // them searchable forever. For a feature whose subject is other people that
  // is not a cosmetic bug.
  it("deleting a person removes their facts, associations, index and chunk rows", async () => {
    const project = createProject({ name: "Acme rebrand" });
    const person = createPerson({ name: "Keith", relationship: "client contact", summary: "Runs the review process." });
    const fact = addPersonFact({ personId: person.id, content: "Cares about accessibility in every review." });
    associate(project.id, person.id, "client contact");

    expect(indexRows("person", person.id)).toBe(1);
    expect(indexRows("memory", fact.id)).toBe(1);

    deletePerson(person.id);

    expect(indexRows("person", person.id)).toBe(0);
    expect(chunkRows("person", person.id)).toBe(0);
    expect(indexRows("memory", fact.id)).toBe(0);
    expect(chunkRows("memory", fact.id)).toBe(0);
    expect(listMemory().find((m) => m.id === fact.id)).toBeUndefined();
    expect(listPeopleForProject(project.id)).toHaveLength(0);
    // And nothing about them is retrievable any more.
    expect(await listPersonMentions({ ...person }, 20)).toHaveLength(0);
    const stillThere = db
      .prepare(`SELECT COUNT(*) n FROM chunk_search WHERE content LIKE '%accessibility in every review%'`)
      .get() as { n: number };
    expect(stillThere.n).toBe(0);
  });

  it("keeps person facts out of the global and Project memory blocks", () => {
    const project = createProject({ name: "P" });
    const person = createPerson({ name: "Keith" });
    createMemory({ scope: "global", content: "A global fact." });
    createMemory({ scope: "project", projectId: project.id, content: "A Project fact." });
    addPersonFact({ personId: person.id, content: "A fact about Keith." });

    // This is the safety property the whole design rests on: neither branch of
    // listMemory matches scope = 'person', so a person fact cannot be swept
    // into a system prompt's memory sections just by living in the same table.
    expect(listMemory({ scope: "global" }).map((m) => m.content)).toEqual(["A global fact."]);
    const forProject = listMemory({ projectId: project.id }).map((m) => m.content);
    expect(forProject).toContain("A Project fact.");
    expect(forProject).toContain("A global fact.");
    expect(forProject).not.toContain("A fact about Keith.");

    // Asked for explicitly, they are there.
    expect(listPersonFacts(person.id).map((f) => f.content)).toEqual(["A fact about Keith."]);
  });

  it("records a fact's provenance and its person, and titles it by name", () => {
    const project = createProject({ name: "P" });
    const conversation = createConversation(project.id, "Kickoff");
    const message = addMessage({ conversationId: conversation.id, role: "user", content: "Keith runs the reviews." });
    const person = createPerson({ name: "Keith" });
    const fact = addPersonFact({
      personId: person.id,
      content: "Runs the review process.",
      sourceMessageId: message.id,
      sourceConversationId: conversation.id,
    });

    expect(fact.scope).toBe("person");
    expect(fact.person_id).toBe(person.id);
    expect(fact.project_id).toBeNull();
    expect(fact.source_message_id).toBe(message.id);

    // A bare fact is close to useless without knowing whose it is, and the
    // title is what retrieval carries into a citation.
    const title = db.prepare(`SELECT title FROM search_index WHERE kind = 'memory' AND ref_id = ?`).get(fact.id) as {
      title: string;
    };
    expect(title.title).toBe("Keith");
  });

  it("re-titles a person's facts when they are renamed", () => {
    const person = createPerson({ name: "Keith" });
    const fact = addPersonFact({ personId: person.id, content: "Runs the review process." });
    updatePerson(person.id, { name: "Keith Bell" });
    const title = db.prepare(`SELECT title FROM search_index WHERE kind = 'memory' AND ref_id = ?`).get(fact.id) as {
      title: string;
    };
    expect(title.title).toBe("Keith Bell");
  });

  it("does not index a suggested fact, and indexes it on promotion", () => {
    const person = createPerson({ name: "Keith" });
    const fact = addPersonFact({ personId: person.id, content: "Might be moving teams.", status: "suggested" });
    expect(indexRows("memory", fact.id)).toBe(0);
    setMemoryStatus(fact.id, "established");
    expect(indexRows("memory", fact.id)).toBe(1);
  });

  it("associates with Projects both ways and dissociates", () => {
    const a = createProject({ name: "A" });
    const b = createProject({ name: "B" });
    const person = createPerson({ name: "Syl" });

    associate(a.id, person.id, "delivers the live sessions");
    associate(b.id, person.id);
    expect(listProjectsForPerson(person.id).map((p) => p.name)).toEqual(["A", "B"]);
    expect(listPeopleForProject(a.id)[0].role).toBe("delivers the live sessions");

    // A person crosses Projects — that is the point of them being global.
    dissociate(a.id, person.id);
    expect(listProjectsForPerson(person.id).map((p) => p.name)).toEqual(["B"]);
  });

  // The roster is what reaches a system prompt, so both halves have to be
  // settled: a suggested person is inert everywhere, and a proposed
  // association is a guess about this Project that nobody has agreed to.
  it("keeps suggested people and proposed associations off the Project roster", () => {
    const project = createProject({ name: "P" });
    const kept = createPerson({ name: "Keith" });
    const suggestedPerson = createPerson({ name: "Marta", status: "suggested" });
    const establishedElsewhere = createPerson({ name: "Syl" });

    associate(project.id, kept.id);
    associate(project.id, suggestedPerson.id, null, { status: "suggested" });
    associate(project.id, establishedElsewhere.id, null, { status: "suggested" });

    expect(listPeopleForProject(project.id)).toHaveLength(3);
    expect(listProjectRoster(project.id).map((p) => p.name)).toEqual(["Keith"]);

    setAssociationStatus(project.id, establishedElsewhere.id, "established");
    expect(listProjectRoster(project.id).map((p) => p.name)).toEqual(["Keith", "Syl"]);

    // Establishing the person is not enough on its own; the association is a
    // second, separate decision.
    setPersonStatus(suggestedPerson.id, "established");
    expect(listProjectRoster(project.id).map((p) => p.name)).toEqual(["Keith", "Syl"]);
  });

  it("never demotes an established association, or erases a role, when re-associating", () => {
    const project = createProject({ name: "P" });
    const person = createPerson({ name: "Keith" });
    associate(project.id, person.id, "client contact");

    // What an episode closing does when it mentions someone already on the
    // Project: it must not undo what the user already settled.
    associate(project.id, person.id, null, { status: "suggested" });

    const row = listPeopleForProject(project.id)[0];
    expect(row.association_status).toBe("established");
    expect(row.role).toBe("client contact");
  });

  it("merges one person into another, carrying facts, Projects, and the name as an alias", () => {
    const project = createProject({ name: "P" });
    const target = createPerson({ name: "Keith Bell", aliases: ["KB"] });
    const source = createPerson({ name: "Keith" });
    addPersonFact({ personId: target.id, content: "Runs the review process." });
    addPersonFact({ personId: source.id, content: "Cares about accessibility." });
    associate(project.id, source.id);

    const merged = mergePeople(source.id, target.id);

    expect(getPerson(source.id)).toBeNull();
    expect(merged?.aliases).toContain("Keith");
    expect(merged?.aliases).toContain("KB");
    expect(listPersonFacts(target.id).map((f) => f.content).sort()).toEqual([
      "Cares about accessibility.",
      "Runs the review process.",
    ]);
    expect(listProjectsForPerson(target.id).map((p) => p.name)).toEqual(["P"]);
    expect(indexRows("person", source.id)).toBe(0);
  });

  it("survives merging someone who shares a Project with the survivor", () => {
    const project = createProject({ name: "P" });
    const target = createPerson({ name: "Keith Bell" });
    const source = createPerson({ name: "Keith" });
    associate(project.id, target.id);
    associate(project.id, source.id);

    expect(mergePeople(source.id, target.id)).not.toBeNull();
    expect(listProjectsForPerson(target.id)).toHaveLength(1);
  });

  it("finds mentions of a person across the archive without any extraction", async () => {
    const project = createProject({ name: "Acme rebrand" });
    const conversation = createConversation(project.id, "Review planning");
    addMessage({
      conversationId: conversation.id,
      role: "user",
      content: "Keith wants the accessibility audit finished before the review board meets.",
    });
    addMessage({ conversationId: conversation.id, role: "assistant", content: "Noted — nothing about that here." });

    const person = createPerson({ name: "Keith" });
    const mentions = await listPersonMentions(person);

    expect(mentions.length).toBeGreaterThan(0);
    expect(mentions.some((m) => m.content.includes("accessibility audit"))).toBe(true);
    // Their own record and their own facts are not "mentions" of themselves.
    expect(mentions.some((m) => m.kind === "person" && m.refId === person.id)).toBe(false);
  });

  // Regression, found while curating a real archive: retrieval's semantic half
  // has no relevance floor, so a person named in three places came back with a
  // full twenty "mentions" — most of them other people's names sitting nearby
  // in embedding space. A mention has to actually mention them.
  it("only returns passages that actually name the person or an alias", async () => {
    const project = createProject({ name: "P" });
    const conversation = createConversation(project.id, "Talk");
    addMessage({ conversationId: conversation.id, role: "user", content: "Krystina is handling the logistics." });
    addMessage({ conversationId: conversation.id, role: "user", content: "Kryssie will chase the schedule." });
    addMessage({
      conversationId: conversation.id,
      role: "user",
      content: "Logistics and scheduling for the session are still open, and someone needs to own them.",
    });

    const person = createPerson({ name: "Krystina", aliases: ["Kryssie"] });
    const mentions = await listPersonMentions(person);

    expect(mentions.length).toBe(2);
    expect(mentions.every((m) => /krystina|kryssie/i.test(m.content))).toBe(true);
  });

  it("does not match a name inside a longer word", async () => {
    const project = createProject({ name: "P" });
    const conversation = createConversation(project.id, "Talk");
    addMessage({ conversationId: conversation.id, role: "user", content: "The syllabus needs a rewrite before Monday." });

    const person = createPerson({ name: "Syl" });
    expect(await listPersonMentions(person)).toHaveLength(0);
  });

  it("excludes a person's own facts from their mentions", async () => {
    const person = createPerson({ name: "Marta" });
    const fact = addPersonFact({ personId: person.id, content: "Marta leads the typography working group." });
    const mentions = await listPersonMentions(person);
    expect(mentions.some((m) => m.kind === "memory" && m.refId === fact.id)).toBe(false);
  });

  it("looks up a person by name or alias, returning only established facts", async () => {
    const project = createProject({ name: "Acme rebrand" });
    const person = createPerson({ name: "Keith", aliases: ["KB"], relationship: "client contact" });
    addPersonFact({ personId: person.id, content: "KEPT_FACT" });
    addPersonFact({ personId: person.id, content: "UNKEPT_FACT", status: "suggested" });
    associate(project.id, person.id);

    const found = (await lookupPerson("KB"))!;
    expect(found.person.id).toBe(person.id);
    expect(found.facts.map((f) => f.content)).toEqual(["KEPT_FACT"]);
    expect(found.projects.map((p) => p.name)).toEqual(["Acme rebrand"]);
  });

  it("does not look up a suggested person, or a name that only nearly matches", async () => {
    const proposed = createPerson({ name: "Marta", status: "suggested" });
    expect(await lookupPerson("Marta")).toBeNull();
    setPersonStatus(proposed.id, "established");
    expect(await lookupPerson("Marta")).not.toBeNull();
    expect(await lookupPerson("Martha")).toBeNull();
  });

  it("hides a proposed association from lookup until it is kept", async () => {
    const project = createProject({ name: "P" });
    const person = createPerson({ name: "Keith" });
    associate(project.id, person.id, null, { status: "suggested" });
    expect((await lookupPerson("Keith"))!.projects).toHaveLength(0);
    setAssociationStatus(project.id, person.id, "established");
    expect((await lookupPerson("Keith"))!.projects).toHaveLength(1);
  });

  it("exports everything held about one person", () => {
    const project = createProject({ name: "Acme rebrand" });
    const conversation = createConversation(project.id, "Kickoff");
    const person = createPerson({ name: "Keith", relationship: "client contact", aliases: ["KB"] });
    addPersonFact({ personId: person.id, content: "Runs the review process.", sourceConversationId: conversation.id });
    associate(project.id, person.id, "client contact");

    const bundle = exportPerson(person.id)!;
    expect(bundle.person.name).toBe("Keith");
    expect(bundle.person.aliases).toEqual(["KB"]);
    expect(bundle.facts).toHaveLength(1);
    expect(bundle.facts[0].source).toBe("Kickoff");
    expect(bundle.projects).toEqual([{ name: "Acme rebrand", role: "client contact" }]);
    expect(exportPerson("person_nope")).toBeNull();
  });
});
