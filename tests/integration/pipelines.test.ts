import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "../helpers/reset";
import { installMockProvider, type MockProvider } from "../helpers/provider";
import { db } from "@/lib/db";
import { createProject } from "@/lib/repo/projects";
import { addMessage, createConversation, listMessages, type Message } from "@/lib/repo/conversations";
import { createDocument } from "@/lib/repo/documents";
import { createMemory, listMemory, setMemoryStatus } from "@/lib/repo/memory";
import { createSkill } from "@/lib/repo/skills";
import {
  addPersonFact,
  associate,
  createPerson,
  listPeople,
  listPeopleForProject,
  listProjectRoster,
} from "@/lib/repo/people";
import { buildHistoryWindow, getConversationSummary, pendingFold } from "@/lib/conversationWindow";
import { draftClosure } from "@/lib/episodeClose";
import { buildSystemPrompt } from "@/lib/contextBuilder";
import { resolveTurnModel, runChatTurn } from "@/lib/chatTurn";
import { createAgentRun, getAgentRun } from "@/lib/repo/agents";
import { runAgent } from "@/lib/agent";
import { runCouncilDeliberation } from "@/lib/council";
import { runPeopleInterestDiscovery, selectCandidates } from "@/lib/peopleInterest";
import { createPeopleInterestRun, getPeopleInterestRun } from "@/lib/repo/peopleInterest";
import { traceTrajectory } from "@/lib/trajectory";
import { SEARCH_KINDS } from "@/lib/searchIndex";
import { createCouncilRun, getCouncilRun } from "@/lib/repo/councils";

let mock: MockProvider;

beforeEach(() => {
  resetDb();
  mock = installMockProvider();
});
afterEach(() => mock.restore());

// Each message carries a unique marker and enough bulk to move the window,
// but not so much that a failed assertion prints pages of filler.
function seedMessages(conversationId: string, count: number, offset = 0): Message[] {
  return Array.from({ length: count }, (_, i) =>
    addMessage({
      conversationId,
      role: i % 2 === 0 ? "user" : "assistant",
      content: `MARK${offset + i}X ${"lorem ".repeat(700)}`,
    })
  );
}

describe("conversation window pipeline", () => {
  it("sends a short conversation whole and calls no model", async () => {
    const project = createProject({ name: "P" });
    const conversation = createConversation(project.id, "Talk");
    seedMessages(conversation.id, 4);

    const windowed = await buildHistoryWindow(conversation.id, listMessages(conversation.id));
    expect(windowed.summary).toBeNull();
    expect(windowed.history).toHaveLength(4);
    expect(mock.calls).toHaveLength(0);
  });

  it("summarizes older turns once a conversation gets long, and stores the summary", async () => {
    const project = createProject({ name: "P" });
    const conversation = createConversation(project.id, "Talk");
    seedMessages(conversation.id, 60);
    mock.setDefaultReply("**Earlier** The conversation settled on a September date.");

    const windowed = await buildHistoryWindow(conversation.id, listMessages(conversation.id));
    expect(mock.calls).toHaveLength(1);
    expect(windowed.summary).toContain("September date");
    expect(windowed.summarizedCount).toBeGreaterThan(0);
    expect(windowed.history.length).toBeLessThan(60);
    expect(getConversationSummary(conversation.id).summary).toContain("September date");
  });

  it("reuses a stored summary instead of paying for it again", async () => {
    const project = createProject({ name: "P" });
    const conversation = createConversation(project.id, "Talk");
    seedMessages(conversation.id, 60);
    mock.setDefaultReply("A summary.");

    await buildHistoryWindow(conversation.id, listMessages(conversation.id));
    expect(mock.calls).toHaveLength(1);
    await buildHistoryWindow(conversation.id, listMessages(conversation.id));
    expect(mock.calls).toHaveLength(1);
  });

  it("folds only the new material when the conversation grows further", async () => {
    const project = createProject({ name: "P" });
    const conversation = createConversation(project.id, "Talk");
    seedMessages(conversation.id, 60);
    mock.setDefaultReply("A summary.");
    await buildHistoryWindow(conversation.id, listMessages(conversation.id));

    seedMessages(conversation.id, 30, 60);
    await buildHistoryWindow(conversation.id, listMessages(conversation.id));

    expect(mock.calls).toHaveLength(2);
    // The second fold is given the prior summary plus only what came after it.
    expect(mock.calls[1].prompt).toContain("Summary of the conversation so far");
    expect(mock.calls[1].prompt).not.toContain("MARK0X");
  });

  it("answers without waiting for the summary to catch up, and folds behind the turn", async () => {
    const project = createProject({ name: "P" });
    const conversation = createConversation(project.id, "Talk");
    seedMessages(conversation.id, 60);
    mock.setDefaultReply("A summary.");
    await buildHistoryWindow(conversation.id, listMessages(conversation.id));
    const foldedThrough = db
      .prepare(`SELECT summary_through_id FROM conversations WHERE id = ?`)
      .get(conversation.id) as { summary_through_id: string };

    // Two more turns: enough to push material out of the window, nowhere near
    // enough to be worth stalling the next answer on.
    const added = seedMessages(conversation.id, 2, 60);
    const windowed = await buildHistoryWindow(conversation.id, listMessages(conversation.id));

    // Answered from the summary it already had, with the turns that aged out
    // since then carried verbatim rather than waited for.
    expect(windowed.summary).toBe("A summary.");
    const sent = windowed.history.map((m) => m.content).join("\n");
    expect(sent).toContain(added[0].content.slice(0, 8));

    // And the fold happened anyway, behind the answer.
    await pendingFold(conversation.id);
    const now = db.prepare(`SELECT summary_through_id FROM conversations WHERE id = ?`).get(conversation.id) as {
      summary_through_id: string;
    };
    expect(now.summary_through_id).not.toBe(foldedThrough.summary_through_id);
  });

  it("falls back to the whole history when summarization fails", async () => {
    const project = createProject({ name: "P" });
    const conversation = createConversation(project.id, "Talk");
    seedMessages(conversation.id, 60);
    mock.failNext("provider exploded");

    const windowed = await buildHistoryWindow(conversation.id, listMessages(conversation.id));
    expect(windowed.summary).toBeNull();
    expect(windowed.history).toHaveLength(60);
  });
});

describe("context assembly", () => {
  it("retrieves passages for the turn's question instead of dumping documents", async () => {
    const project = createProject({ name: "P" });
    createDocument(project.id, "Irrelevant", "Filler about gardening. ".repeat(400));
    createDocument(project.id, "Relevant", "The migration runs on Tuesday at dawn. ".repeat(60));

    const { system, turnContext, provenance } = await buildSystemPrompt({
      projectId: project.id,
      query: "when does the migration run",
    });
    expect(provenance.retrievalMode).toBe("retrieval");
    expect(turnContext).toContain("Retrieved from this Project");
    expect(turnContext).toContain("migration runs on Tuesday");
    expect(provenance.retrieved?.length).toBeGreaterThan(0);
    // Passages belong to the message, not to the standing prompt — keeping the
    // system prompt identical across a conversation is what makes it cacheable.
    expect(system).not.toContain("migration runs on Tuesday");
  });

  it("sends retrieved passages with the message they were retrieved for, not in the standing prompt", async () => {
    const project = createProject({ name: "P" });
    createDocument(project.id, "Relevant", "The migration runs on Tuesday at dawn. ".repeat(60));
    const conversation = createConversation(project.id, "Talk");
    const earlier = addMessage({ conversationId: conversation.id, role: "user", content: "An earlier question." });
    addMessage({ conversationId: conversation.id, role: "assistant", content: "An earlier answer.", parentId: earlier.id });
    const asking = addMessage({ conversationId: conversation.id, role: "user", content: "when does the migration run" });

    const turnModel = await resolveTurnModel("default", asking.content, null);
    if (!turnModel.ok) throw new Error("model did not resolve");
    const response = await runChatTurn({
      conversationId: conversation.id,
      projectId: project.id,
      history: listMessages(conversation.id).map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
      skillId: null,
      turnModel: turnModel.value,
      signal: new AbortController().signal,
      excludeRefIds: [asking.id],
      parentId: asking.id,
    });
    await response.text();

    const call = mock.calls[mock.calls.length - 1];
    // The passages arrive attached to the live turn...
    expect(call.prompt).toContain("migration runs on Tuesday");
    expect(call.prompt).toContain("when does the migration run");
    expect(call.prompt.indexOf("migration runs on Tuesday")).toBeLessThan(
      call.prompt.indexOf("when does the migration run")
    );
    // ...and not in the system prompt, which has to stay identical from one
    // turn to the next for the provider's cache to hit it.
    expect(call.system).not.toContain("migration runs on Tuesday");
    expect(call.system).toContain("## Project: P");
  });

  it("falls back to whole documents when nothing matches", async () => {
    const project = createProject({ name: "P" });
    createDocument(project.id, "Doc", "Gardening notes about compost.");

    const { provenance } = await buildSystemPrompt({
      projectId: project.id,
      query: "zzzznonexistenttopic",
    });
    expect(provenance.retrievalMode).toBe("documents");
    expect(provenance.documentsUsed.length).toBeGreaterThan(0);
  });

  // The invariant the whole deliberate-memory design rests on.
  it("never puts suggested memory into the prompt", async () => {
    const project = createProject({ name: "P" });
    createMemory({ scope: "project", projectId: project.id, content: "ESTABLISHED_FACT", status: "established" });
    createMemory({ scope: "project", projectId: project.id, content: "SUGGESTED_FACT", status: "suggested" });

    const { system } = await buildSystemPrompt({ projectId: project.id, query: "anything" });
    expect(system).toContain("ESTABLISHED_FACT");
    expect(system).not.toContain("SUGGESTED_FACT");
  });

  // The property the People feature rests on. A fact about a third party is an
  // ordinary memory row, so the only thing keeping it out of the Project and
  // global memory blocks is that scope = 'person' matches neither branch of
  // listMemory. If that ever stops being true, every person fact starts
  // arriving in every turn of the Project they were mentioned in.
  it("never puts a person's facts into the global or Project memory blocks", async () => {
    const project = createProject({ name: "P" });
    const person = createPerson({ name: "Keith" });
    createMemory({ scope: "project", projectId: project.id, content: "PROJECT_FACT" });
    addPersonFact({ personId: person.id, content: "PERSON_FACT_ABOUT_KEITH" });

    const { system } = await buildSystemPrompt({ projectId: project.id, query: "Keith" });
    expect(system).toContain("PROJECT_FACT");
    expect(system).not.toContain("PERSON_FACT_ABOUT_KEITH");
  });

  it("never puts a suggested person or a suggested fact into the prompt", async () => {
    const project = createProject({ name: "P" });
    const proposed = createPerson({ name: "SUGGESTED_PERSON_MARTA", status: "suggested", summary: "A collaborator." });
    const kept = createPerson({ name: "Keith" });
    addPersonFact({ personId: kept.id, content: "SUGGESTED_FACT_ABOUT_KEITH", status: "suggested" });

    const { system } = await buildSystemPrompt({ projectId: project.id, query: "Marta Keith collaborator" });
    expect(system).not.toContain("SUGGESTED_PERSON_MARTA");
    expect(system).not.toContain("SUGGESTED_FACT_ABOUT_KEITH");
    // Not merely absent from the prompt — never indexed, so retrieval cannot
    // reach them either.
    expect(
      (db.prepare(`SELECT COUNT(*) n FROM chunks WHERE kind = 'person' AND ref_id = ?`).get(proposed.id) as { n: number })
        .n
    ).toBe(0);
  });

  it("dates every memory item and names where it came from", async () => {
    const project = createProject({ name: "P" });
    const conversation = createConversation(project.id, "Origin conversation");
    createMemory({
      scope: "project",
      projectId: project.id,
      content: "A remembered claim.",
      sourceConversationId: conversation.id,
    });

    const { system } = await buildSystemPrompt({ projectId: project.id, query: "anything" });
    expect(system).toMatch(/- \(\d{4}-\d{2}-\d{2}, from "Origin conversation"\) A remembered claim\./);
  });

  it("includes the rolling summary when one is supplied", async () => {
    const project = createProject({ name: "P" });
    const { system, provenance } = await buildSystemPrompt({
      projectId: project.id,
      query: "anything",
      conversationSummary: { text: "PRIOR_SUMMARY", messageCount: 42 },
    });
    expect(system).toContain("Earlier in this conversation");
    expect(system).toContain("PRIOR_SUMMARY");
    expect(provenance.summarizedMessages).toBe(42);
  });
});

describe("episode closing", () => {
  const REPLY = `<<<CLOSEOUT>>>
Summary:
The conversation settled the delivery date.

**Decisions:**
- Ship the deck by Sept 19.

Open questions:
- Does the co-CEO need a pre-brief?

Remember in this Project:
- The live session is Sept 21.

Remember globally:
None.
<<<END>>>`;

  it("turns a reply into inert proposals, not into memory", async () => {
    const project = createProject({ name: "P" });
    const conversation = createConversation(project.id, "Talk");
    addMessage({ conversationId: conversation.id, role: "user", content: "When is the session?" });
    mock.setDefaultReply(REPLY);

    const draft = await draftClosure(conversation.id);

    expect(draft.closure.summary).toBe("The conversation settled the delivery date.");
    expect(draft.notes.filter((n) => n.kind === "decision")).toHaveLength(1);
    expect(draft.notes.filter((n) => n.kind === "question")).toHaveLength(1);
    // Everything it proposes must be in a state nothing acts on.
    expect(draft.notes.every((n) => n.status === "proposed")).toBe(true);
    expect(draft.memory).toHaveLength(1);
    expect(draft.memory[0].status).toBe("suggested");
    expect(draft.memory[0].source_conversation_id).toBe(conversation.id);
  });

  it("keeps proposals out of the next prompt until they are established", async () => {
    const project = createProject({ name: "P" });
    const conversation = createConversation(project.id, "Talk");
    addMessage({ conversationId: conversation.id, role: "user", content: "When is the session?" });
    mock.setDefaultReply(REPLY);
    await draftClosure(conversation.id);

    const { system } = await buildSystemPrompt({ projectId: project.id, query: "session" });
    expect(system).not.toContain("The live session is Sept 21.");
  });

  it("replaces un-kept proposals on a redraft and spares the kept ones", async () => {
    const project = createProject({ name: "P" });
    const conversation = createConversation(project.id, "Talk");
    addMessage({ conversationId: conversation.id, role: "user", content: "q" });
    mock.setDefaultReply(REPLY);
    const first = await draftClosure(conversation.id);

    db.prepare(`UPDATE memory SET status = 'established' WHERE id = ?`).run(first.memory[0].id);
    db.prepare(`UPDATE project_notes SET status = 'settled' WHERE id = ?`).run(first.notes[0].id);

    const second = await draftClosure(conversation.id);
    expect(second.closure.id).not.toBe(first.closure.id);
    // The kept rows survive; the un-kept ones were replaced rather than doubled.
    expect(listMemory().filter((m) => m.status === "established")).toHaveLength(1);
    expect(second.memory).toHaveLength(1);
  });

  it("refuses to close an empty conversation", async () => {
    const project = createProject({ name: "P" });
    const conversation = createConversation(project.id, "Empty");
    await expect(draftClosure(conversation.id)).rejects.toThrow(/nothing in this conversation/i);
  });

  const PEOPLE_REPLY = (people: string) => `<<<CLOSEOUT>>>
Summary:
A working session.

Decisions:
None.

Open questions:
None.

Remember in this Project:
None.

Remember globally:
None.

People:
${people}
<<<END>>>`;

  it("proposes an unknown name as a suggested person, with a suggested fact and a proposed association", async () => {
    const project = createProject({ name: "P" });
    const conversation = createConversation(project.id, "Talk");
    addMessage({ conversationId: conversation.id, role: "user", content: "q" });
    mock.setDefaultReply(PEOPLE_REPLY("- Marta — leads the typography working group."));

    const draft = await draftClosure(conversation.id);

    expect(draft.people).toHaveLength(1);
    const { person, facts } = draft.people[0];
    expect(person.name).toBe("Marta");
    expect(person.status).toBe("suggested");
    expect(facts).toHaveLength(1);
    expect(facts[0].status).toBe("suggested");
    expect(facts[0].content).toBe("leads the typography working group.");
    expect(facts[0].source_conversation_id).toBe(conversation.id);
    // Proposed, not made: nothing has put her on the roster the model sees.
    expect(listProjectRoster(project.id)).toHaveLength(0);
    expect(listPeopleForProject(project.id)[0].association_status).toBe("suggested");
  });

  it("adds a fact to a person already in the roster rather than duplicating them", async () => {
    const project = createProject({ name: "P" });
    const conversation = createConversation(project.id, "Talk");
    addMessage({ conversationId: conversation.id, role: "user", content: "q" });
    const existing = createPerson({ name: "Keith Bell", aliases: ["Keith"] });
    mock.setDefaultReply(PEOPLE_REPLY("- Keith — cares about accessibility in every review."));

    const draft = await draftClosure(conversation.id);

    expect(listPeople()).toHaveLength(1);
    expect(draft.people).toHaveLength(1);
    expect(draft.people[0].person.id).toBe(existing.id);
    // Matched by alias, and the person themselves is untouched — still
    // established, not demoted by having been mentioned.
    expect(draft.people[0].person.status).toBe("established");
    expect(draft.people[0].facts[0].status).toBe("suggested");
  });

  // §4.1 — the encyclopedia problem. A Project about the history of technology
  // must not turn Turing into a rolodex entry.
  it("proposes nobody for a conversation about historical figures", async () => {
    const project = createProject({ name: "History of Technology" });
    const conversation = createConversation(project.id, "Talk");
    addMessage({ conversationId: conversation.id, role: "user", content: "Tell me about Turing." });
    mock.setDefaultReply(PEOPLE_REPLY("None."));

    const draft = await draftClosure(conversation.id);
    expect(draft.people).toHaveLength(0);
    expect(listPeople()).toHaveLength(0);
  });

  it("hands the closing model the existing roster so it can match by exact name", async () => {
    const project = createProject({ name: "P" });
    const conversation = createConversation(project.id, "Talk");
    addMessage({ conversationId: conversation.id, role: "user", content: "q" });
    createPerson({ name: "Keith Bell", aliases: ["KB"] });
    mock.setDefaultReply(PEOPLE_REPLY("None."));

    await draftClosure(conversation.id);

    expect(mock.calls[0].prompt).toContain("Keith Bell (also: KB)");
  });

  it("replaces un-kept people on a redraft but never one whose facts were kept", async () => {
    const project = createProject({ name: "P" });
    const conversation = createConversation(project.id, "Talk");
    addMessage({ conversationId: conversation.id, role: "user", content: "q" });
    mock.setDefaultReply(PEOPLE_REPLY("- Marta — leads typography.\n- Nils — runs the print vendor."));
    const first = await draftClosure(conversation.id);

    const marta = first.people.find((p) => p.person.name === "Marta")!;
    // The user kept a fact about Marta but has not yet kept Marta herself.
    setMemoryStatus(marta.facts[0].id, "established");

    mock.setDefaultReply(PEOPLE_REPLY("- Nils — runs the print vendor."));
    await draftClosure(conversation.id);

    const names = listPeople().map((p) => p.name).sort();
    // Nils was re-proposed; Marta survived because deleting her would have
    // taken an established fact with her.
    expect(names).toEqual(["Marta", "Nils"]);
    expect(listMemory({ personId: marta.person.id }).filter((f) => f.status === "established")).toHaveLength(1);
  });
});

describe("the Project roster in a prompt", () => {
  it("names established people and points the model at lookup_person", async () => {
    const project = createProject({ name: "P" });
    const person = createPerson({ name: "Keith", relationship: "client contact", summary: "Runs the reviews." });
    addPersonFact({ personId: person.id, content: "SECRET_FACT_ABOUT_KEITH" });
    associate(project.id, person.id);

    const { system, provenance } = await buildSystemPrompt({ projectId: project.id, query: "Keith" });

    expect(system).toContain("People on this Project");
    expect(system).toContain("- Keith — client contact. Runs the reviews.");
    expect(system).toContain("lookup_person");
    expect(provenance.peopleOnProject).toBe(1);
    // Who they are, not what is known about them.
    expect(system).not.toContain("SECRET_FACT_ABOUT_KEITH");
  });

  it("caps the roster and says how many were left out", async () => {
    const project = createProject({ name: "P" });
    for (let i = 0; i < 15; i++) {
      const person = createPerson({ name: `Person ${String(i).padStart(2, "0")}` });
      associate(project.id, person.id);
    }

    const { system, provenance } = await buildSystemPrompt({ projectId: project.id, query: "anything" });

    expect(provenance.peopleOnProject).toBe(12);
    expect(system).toContain("Person 11");
    expect(system).not.toContain("Person 12");
    expect(system).toContain("…and 3 more");
  });

  it("omits the block entirely when the Project has nobody established on it", async () => {
    const project = createProject({ name: "P" });
    const proposed = createPerson({ name: "Marta", status: "suggested" });
    associate(project.id, proposed.id, null, { status: "suggested" });

    const { system, provenance } = await buildSystemPrompt({ projectId: project.id, query: "Marta" });
    expect(system).not.toContain("People on this Project");
    expect(system).not.toContain("Marta");
    expect(provenance.peopleOnProject).toBe(0);
  });
});

describe("who might be interested in this", () => {
  const REPLY = (relevance: string, why: string) => `Relevance: ${relevance}\n\nWhy: ${why}`;

  it("weighs each established person and records the evidence", async () => {
    const project = createProject({ name: "Accessibility programme" });
    const conversation = createConversation(project.id, "Talk");
    addMessage({ conversationId: conversation.id, role: "user", content: "Keith and Nils were both at the review." });

    const keith = createPerson({ name: "Keith", relationship: "client contact" });
    addPersonFact({ personId: keith.id, content: "Cares about accessibility in every review." });
    createPerson({ name: "Nils", relationship: "print vendor" });
    createPerson({ name: "Marta", status: "suggested" });

    const run = createPeopleInterestRun(project.id);
    mock.setDefaultReply((opts) =>
      String(opts.messages[0].content).includes("Keith")
        ? REPLY("Strong", "Their recorded interest in accessibility is this Project's subject.")
        : REPLY("None", "No real connection.")
    );

    await runPeopleInterestDiscovery({ runId: run.id, projectId: project.id });

    const finished = getPeopleInterestRun(run.id)!;
    expect(finished.status).toBe("complete");
    // A suggested person is inert everywhere, this included.
    expect(finished.findings.map((f) => f.personName).sort()).toEqual(["Keith", "Nils"]);
    const forKeith = finished.findings.find((f) => f.personName === "Keith")!;
    expect(forKeith.relevance).toBe("Strong");
    expect(forKeith.summary).toContain("accessibility");
  });

  it("gives the model what is recorded about the person, and nothing invented", async () => {
    const project = createProject({ name: "P" });
    const person = createPerson({ name: "Keith", relationship: "client contact" });
    addPersonFact({ personId: person.id, content: "KEPT_FACT" });
    addPersonFact({ personId: person.id, content: "UNKEPT_FACT", status: "suggested" });
    associate(project.id, person.id);

    const run = createPeopleInterestRun(project.id);
    mock.setDefaultReply(REPLY("None", "No real connection."));
    await runPeopleInterestDiscovery({ runId: run.id, projectId: project.id });

    const prompt = mock.calls[0].prompt;
    expect(prompt).toContain("KEPT_FACT");
    expect(prompt).not.toContain("UNKEPT_FACT");
    // The instruction that keeps a manufactured link from being an acceptable
    // answer lives in the system prompt, so it must actually be sent.
    expect(mock.calls[0].system).toContain("Do not manufacture a connection");
  });

  it("marks someone already on the Project, and only when the association is kept", async () => {
    const project = createProject({ name: "P" });
    const conversation = createConversation(project.id, "Talk");
    // Syl's association is only proposed, so he qualifies as a candidate on the
    // strength of being mentioned rather than on the association.
    addMessage({ conversationId: conversation.id, role: "user", content: "Syl asked about the timeline." });
    const onIt = createPerson({ name: "Keith" });
    const proposed = createPerson({ name: "Syl" });
    associate(project.id, onIt.id);
    associate(project.id, proposed.id, null, { status: "suggested" });

    const run = createPeopleInterestRun(project.id);
    mock.setDefaultReply(REPLY("Moderate", "Some connection."));
    await runPeopleInterestDiscovery({ runId: run.id, projectId: project.id });

    const findings = getPeopleInterestRun(run.id)!.findings;
    expect(findings.find((f) => f.personName === "Keith")!.alreadyOnProject).toBe(true);
    expect(findings.find((f) => f.personName === "Syl")!.alreadyOnProject).toBe(false);
  });

  it("records a failure on the run rather than throwing", async () => {
    const project = createProject({ name: "P" });
    const person = createPerson({ name: "Keith" });
    associate(project.id, person.id);
    const run = createPeopleInterestRun(project.id);
    mock.failNext("provider exploded");

    await runPeopleInterestDiscovery({ runId: run.id, projectId: project.id });

    const finished = getPeopleInterestRun(run.id)!;
    expect(finished.status).toBe("error");
    expect(finished.findings.some((f) => f.summary.includes("provider exploded"))).toBe(true);
  });

  // One Ask used to be up to 24 sequential model calls with tools, whatever
  // was in the rolodex. Someone with no link to this Project and no mention
  // anywhere gives the model nothing to reason from — which is precisely the
  // thin material that produces a manufactured link.
  it("skips people with neither an association nor a single mention", async () => {
    const project = createProject({ name: "P" });
    const conversation = createConversation(project.id, "Talk");
    addMessage({ conversationId: conversation.id, role: "user", content: "Keith raised it at the review." });

    const mentioned = createPerson({ name: "Keith" });
    const associated = createPerson({ name: "Anna" });
    associate(project.id, associated.id);
    createPerson({ name: "Zoltan" });

    const { candidates, skipped } = await selectCandidates(project.id);
    expect(candidates.map((c) => c.person.name).sort()).toEqual(["Anna", "Keith"]);
    expect(skipped).toEqual(["Zoltan"]);
    expect(candidates.find((c) => c.person.id === mentioned.id)!.alreadyOnProject).toBe(false);
  });
});

describe("retrieval hygiene", () => {
  // The turn's own message is written and indexed before the prompt is built,
  // and it is a perfect lexical match for the query — because it *is* the
  // query — so it reliably retrieved itself as the top passage and spent the
  // budget telling the model what the user had just said.
  it("does not retrieve the message the turn is answering", async () => {
    const project = createProject({ name: "P" });
    const conversation = createConversation(project.id, "Talk");
    createDocument(project.id, "Notes", "The kestrel hunts at dusk over the water meadows. ".repeat(40));
    const asking = addMessage({
      conversationId: conversation.id,
      role: "user",
      content: "What did we say about the kestrel hunting at dusk?",
    });

    const withoutGuard = await buildSystemPrompt({ projectId: project.id, query: asking.content });
    expect(withoutGuard.provenance.retrieved?.some((p) => p.refId === asking.id)).toBe(true);

    const guarded = await buildSystemPrompt({
      projectId: project.id,
      query: asking.content,
      excludeRefIds: [asking.id],
    });
    expect(guarded.provenance.retrieved?.some((p) => p.refId === asking.id)).toBe(false);
    // And the budget it was occupying goes to real material instead.
    expect(guarded.provenance.retrieved?.length).toBeGreaterThan(0);
  });

  // FTS5 indexes every declared column unless told not to. With chunk_id
  // indexed, ids joined the same term pool as the prose: searchable as text,
  // and counted into the document lengths bm25 normalizes against.
  it("does not index the passage table's own id column", () => {
    const project = createProject({ name: "P" });
    const conversation = createConversation(project.id, "Talk");
    const message = addMessage({ conversationId: conversation.id, role: "user", content: "Ordinary prose here." });

    const chunkId = (db.prepare(`SELECT id FROM chunks WHERE ref_id = ?`).get(message.id) as { id: string }).id;
    const hits = db
      .prepare(`SELECT COUNT(*) n FROM chunk_search WHERE chunk_search MATCH ?`)
      .get(`"${chunkId}"`) as { n: number };
    expect(hits.n).toBe(0);
  });

  it("does not present its own earlier replies as the Project's ground truth", async () => {
    const project = createProject({ name: "P" });
    const conversation = createConversation(project.id, "Talk");
    addMessage({
      conversationId: conversation.id,
      role: "assistant",
      content: "The migration runs on Tuesday at dawn, according to my earlier reading. ".repeat(20),
    });

    const { turnContext } = await buildSystemPrompt({ projectId: project.id, query: "when does the migration run" });
    expect(turnContext).toContain("your own earlier reply");
    expect(turnContext).not.toContain("Treat them as ground truth");
  });
});

describe("person trajectory", () => {
  // What the person page's Over time section asks for: everything except
  // rolodex records themselves.
  const PERSON_KINDS = SEARCH_KINDS.filter((k) => k !== "person");

  it("traces a person by name and alias across the archive, dated", async () => {
    const project = createProject({ name: "P" });
    const conversation = createConversation(project.id, "Talk");
    addMessage({
      conversationId: conversation.id,
      role: "user",
      content: "Keith wants the accessibility audit finished before the review board meets.",
    });
    const person = createPerson({ name: "Keith", aliases: ["KB"] });

    const trajectory = await traceTrajectory([person.name, ...person.aliases].join(" "), {
      kinds: PERSON_KINDS,
    });

    expect(trajectory.totalPassages).toBeGreaterThan(0);
    expect(trajectory.periods.length).toBeGreaterThan(0);
    expect(trajectory.firstDate).toBeTruthy();
  });

  // Regression, found against the real archive while building this: the
  // semantic half of retrieval has no relevance floor, so it always returns a
  // full pool. Counting that pool made every query — including one matching
  // nothing at all — report exactly POOL_SIZE passages with an invented shape.
  it("reports nothing for a query the archive does not actually match", async () => {
    const project = createProject({ name: "P" });
    const conversation = createConversation(project.id, "Talk");
    addMessage({ conversationId: conversation.id, role: "user", content: "The kestrel hunts at dusk." });

    const trajectory = await traceTrajectory("zzzzunrelatedtopic");
    expect(trajectory.totalPassages).toBe(0);
    expect(trajectory.periods).toEqual([]);
    expect(trajectory.firstDate).toBeNull();
  });

  // The bars are a picture of the same number the header states. They used to
  // be able to sum to more than it, because each period's count could come
  // from the size of its slice of the retrieval pool.
  it("never claims more passages across its periods than in total", async () => {
    const project = createProject({ name: "P" });
    const conversation = createConversation(project.id, "Talk");
    for (let i = 0; i < 12; i++) {
      addMessage({ conversationId: conversation.id, role: "user", content: `The kestrel hunts at dusk, note ${i}.` });
    }

    const trajectory = await traceTrajectory("kestrel");
    const summed = trajectory.periods.reduce((n, p) => n + p.count, 0);
    expect(summed).toBe(trajectory.totalPassages);
  });

  // A rolodex record is indexed under the person's own name and dated when it
  // was written, so including it would put a false point at "today" on the end
  // of every person's timeline — an entry is not an occasion they came up.
  it("does not count a person's own record as a mention of them", async () => {
    const person = createPerson({ name: "Zzzznobodyhere", summary: "Nobody mentions them anywhere." });

    expect((await traceTrajectory(person.name)).totalPassages).toBeGreaterThan(0);
    const scoped = await traceTrajectory(person.name, { kinds: PERSON_KINDS });
    expect(scoped.totalPassages).toBe(0);
    expect(scoped.periods).toEqual([]);
  });
});

describe("agent pipeline", () => {
  it("runs the built-in five stages and saves an artifact", async () => {
    const project = createProject({ name: "P" });
    const run = createAgentRun({ objective: "Investigate something", projectId: project.id });
    mock.setDefaultReply("Stage output.");

    await runAgent({ runId: run.id, objective: "Investigate something", projectId: project.id });

    const finished = getAgentRun(run.id)!;
    expect(finished.status).toBe("complete");
    expect(finished.steps.map((s) => s.type)).toEqual([
      "plan",
      "research",
      "draft",
      "critique",
      "revise",
      "final",
    ]);
    expect(finished.artifact_id).toBeTruthy();
  });

  it("runs a Skill's stages instead of the built-in pipeline", async () => {
    const project = createProject({ name: "P" });
    const skill = createSkill({
      scope: "global",
      name: "Two-Stage",
      instructions: "Method.",
      modelRole: "fast",
      stages: [
        { name: "List", instructions: "list things", modelRole: "fast", useTools: false },
        { name: "Pick", instructions: "pick one", modelRole: null, useTools: false },
      ],
    });
    const run = createAgentRun({ objective: "Choose", projectId: project.id, skillId: skill.id });
    mock.reply("Red, Yellow, Blue");
    mock.reply("Red.");

    await runAgent({ runId: run.id, objective: "Choose", projectId: project.id, skillId: skill.id });

    const finished = getAgentRun(run.id)!;
    expect(finished.status).toBe("complete");
    expect(finished.steps.map((s) => s.title)).toEqual(["List", "Pick", "Complete"]);
    expect(finished.steps[0].type).toBe("stage");
    // The second stage must actually see the first stage's output.
    expect(mock.calls[1].prompt).toContain("Red, Yellow, Blue");
    expect(mock.calls[1].system).toContain("Two-Stage");
  });

  it("records a provider failure as an error rather than hanging", async () => {
    const project = createProject({ name: "P" });
    const run = createAgentRun({ objective: "Fail", projectId: project.id });
    mock.failNext("429 Provider returned error");

    await runAgent({ runId: run.id, objective: "Fail", projectId: project.id });

    const finished = getAgentRun(run.id)!;
    expect(finished.status).toBe("error");
    expect(finished.steps[0].type).toBe("error");
    expect(finished.steps[0].content).toContain("429");
  });

  it("only offers tools to the stage that asked for them", async () => {
    const project = createProject({ name: "P" });
    const skill = createSkill({
      scope: "global",
      name: "Selective",
      instructions: "Method.",
      stages: [
        { name: "Think", instructions: "think", useTools: false },
        { name: "Look", instructions: "look things up", useTools: true },
      ],
    });
    const run = createAgentRun({ objective: "Go", projectId: project.id, skillId: skill.id });
    mock.setDefaultReply("output");

    await runAgent({ runId: run.id, objective: "Go", projectId: project.id, skillId: skill.id });

    expect(mock.calls[0].toolNames).toHaveLength(0);
    expect(mock.calls[1].toolNames.length).toBeGreaterThan(0);
  });
});

describe("council pipeline", () => {
  it("runs analysis, critique and synthesis, and preserves disagreement", async () => {
    const project = createProject({ name: "P" });
    const run = createCouncilRun({ question: "Is it wise?", projectId: project.id, mode: "independent" });
    mock.setDefaultReply(
      "Consensus: Moderate\n\nKey disagreement: They disagreed about timing.\n\nSynthesis: On balance, yes."
    );

    await runCouncilDeliberation({
      runId: run.id,
      question: "Is it wise?",
      projectId: project.id,
      mode: "independent",
      roles: [
        { name: "Reasoner", systemPrompt: "Reason.", modelRole: "reasoner" },
        { name: "Critic", systemPrompt: "Doubt.", modelRole: "critic" },
      ],
    });

    const finished = getCouncilRun(run.id)!;
    expect(finished.status).toBe("complete");
    expect(finished.consensus).toBe("Moderate");
    expect(finished.disagreement).toContain("timing");
    expect(finished.transcript.map((t) => t.stage)).toEqual([
      "analysis",
      "analysis",
      "critique",
      "critique",
      "synthesis",
    ]);
  });

  it("lets a member work by a Skill without overriding what the role states", async () => {
    const project = createProject({ name: "P" });
    const skill = createSkill({
      scope: "global",
      name: "Careful Method",
      instructions: "METHOD_MARKER",
      modelRole: "researcher",
    });
    const run = createCouncilRun({ question: "Q", projectId: project.id, mode: "independent" });
    mock.setDefaultReply("Consensus: Strong\n\nKey disagreement: None\n\nSynthesis: Yes.");

    await runCouncilDeliberation({
      runId: run.id,
      question: "Q",
      projectId: project.id,
      mode: "independent",
      roles: [
        // No modelRole of its own: the Skill's should be used.
        { name: "Member", systemPrompt: "ROLE_MARKER", modelRole: "", skillId: skill.id },
      ],
    });

    const first = mock.calls[0];
    expect(first.system).toContain("METHOD_MARKER");
    expect(first.system).toContain("ROLE_MARKER");
    expect(first.model).toBe("mock-researcher");
  });

  it("reports a failure on the run rather than throwing", async () => {
    const project = createProject({ name: "P" });
    const run = createCouncilRun({ question: "Q", projectId: project.id, mode: "independent" });
    mock.failNext("provider down");

    await runCouncilDeliberation({
      runId: run.id,
      question: "Q",
      projectId: project.id,
      mode: "independent",
      roles: [{ name: "One", systemPrompt: "x", modelRole: "default" }],
    });

    const finished = getCouncilRun(run.id)!;
    expect(finished.status).toBe("error");
    expect(finished.synthesis).toContain("provider down");
  });
});
