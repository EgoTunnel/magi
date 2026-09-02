import { db, newId, nowIso } from "@/lib/db";
import { indexRemove, indexUpsert } from "@/lib/searchIndex";
import { retrieveChunks, type RetrievedChunk } from "@/lib/retrieval";
import { createMemory, deleteMemory, listMemory, type MemoryItem } from "@/lib/repo/memory";

// An advanced rolodex, not a CRM. What is stored about a person is what the
// user *knows* about them and where that was learned — never contact details,
// never a birthday, never a relationship score. See docs/People-Plan.md §2 for
// the non-goals, which are as much a part of this feature as the schema.
//
// Facts about a person are ordinary `memory` rows (scope 'person'), not a
// parallel table: that is what gives them established/suggested status,
// claim-level provenance, dating, and exclusion from prompts and from the index
// while suggested, without any of it being reimplemented here slightly wrong.
export interface Person {
  id: string;
  name: string;
  // Exact alternate names only. Matching a person is never fuzzy — a wrong
  // merge in a rolodex is worse than a miss, because the user acts on it.
  aliases: string[];
  relationship: string | null;
  summary: string | null;
  status: "established" | "suggested";
  closure_id: string | null;
  source_conversation_id: string | null;
  created_at: string;
  updated_at: string;
}

interface PersonRow extends Omit<Person, "aliases"> {
  aliases: string;
}

function hydrate(row: PersonRow): Person {
  let aliases: string[] = [];
  try {
    const parsed = JSON.parse(row.aliases);
    if (Array.isArray(parsed)) aliases = parsed.filter((a): a is string => typeof a === "string");
  } catch {
    // A malformed aliases blob means "no known alternates", not a broken page.
  }
  return { ...row, aliases };
}

// What goes into the search index for the person record itself: small enough to
// produce exactly one passage. Aliases are included because they are the only
// sanctioned way to find someone under another name — the same reason §4.2
// makes them the matching mechanism rather than allowing fuzzy matches.
//
// A person's *facts* are deliberately not folded in here. They index
// separately as `memory`, and duplicating them into the person record would
// double-count them in retrieval and inflate trajectory counts.
function indexContent(person: Person): string {
  return [person.name, ...person.aliases, person.relationship, person.summary]
    .filter((v): v is string => !!v && v.trim().length > 0)
    .join("\n");
}

// Same posture as suggested memory: a person Magi proposed is inert until kept,
// and an indexed suggestion is a retrievable one, which would put it in front
// of the model as a cited passage before the user ever agreed it was real.
function reindexPerson(person: Person) {
  if (person.status !== "established") {
    indexRemove("person", person.id);
    return;
  }
  indexUpsert({
    kind: "person",
    refId: person.id,
    projectId: null,
    title: person.name,
    content: indexContent(person),
    sourceDate: person.created_at,
  });
}

export function listPeople(opts: { status?: Person["status"] } = {}): Person[] {
  const rows = opts.status
    ? (db.prepare(`SELECT * FROM people WHERE status = ? ORDER BY name COLLATE NOCASE ASC`).all(opts.status) as PersonRow[])
    : (db.prepare(`SELECT * FROM people ORDER BY name COLLATE NOCASE ASC`).all() as PersonRow[]);
  return rows.map(hydrate);
}

export function getPerson(id: string): Person | null {
  const row = db.prepare(`SELECT * FROM people WHERE id = ?`).get(id) as PersonRow | undefined;
  return row ? hydrate(row) : null;
}

// Exact match on name or on a declared alias, case-insensitive. This is the
// only lookup-by-name there is, and it is deliberately unforgiving: extraction
// matches a known person or proposes a new one, and never guesses that two
// names are the same human.
export function findPersonByName(name: string): Person | null {
  const needle = name.trim().toLowerCase();
  if (!needle) return null;
  const people = listPeople();
  return (
    people.find((p) => p.name.toLowerCase() === needle) ??
    people.find((p) => p.aliases.some((a) => a.toLowerCase() === needle)) ??
    null
  );
}

export function createPerson(input: {
  name: string;
  aliases?: string[];
  relationship?: string | null;
  summary?: string | null;
  status?: Person["status"];
  closureId?: string | null;
  sourceConversationId?: string | null;
}): Person {
  const id = newId("person");
  const ts = nowIso();
  db.prepare(
    `INSERT INTO people (id, name, aliases, relationship, summary, status, closure_id, source_conversation_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.name.trim(),
    JSON.stringify(input.aliases ?? []),
    input.relationship ?? null,
    input.summary ?? null,
    input.status ?? "established",
    input.closureId ?? null,
    input.sourceConversationId ?? null,
    ts,
    ts
  );
  const person = getPerson(id)!;
  reindexPerson(person);
  return person;
}

export function updatePerson(
  id: string,
  input: { name?: string; aliases?: string[]; relationship?: string | null; summary?: string | null }
): Person | null {
  const existing = getPerson(id);
  if (!existing) return null;
  const name = input.name?.trim() || existing.name;
  const renamed = name !== existing.name;
  db.prepare(
    `UPDATE people SET name = ?, aliases = ?, relationship = ?, summary = ?, updated_at = ? WHERE id = ?`
  ).run(
    name,
    JSON.stringify(input.aliases ?? existing.aliases),
    input.relationship !== undefined ? input.relationship : existing.relationship,
    input.summary !== undefined ? input.summary : existing.summary,
    nowIso(),
    id
  );
  const person = getPerson(id)!;
  reindexPerson(person);
  // A person's facts are indexed under their name (see memoryTitle in the
  // memory repo), so renaming has to carry through or every one of their facts
  // stays filed under the old name in retrieval and in citations.
  if (renamed) reindexFacts(id);
  return person;
}

// Re-runs each established fact through the index so it picks up the current
// title. Cheap — a person has a handful of facts, not thousands.
function reindexFacts(personId: string) {
  const person = getPerson(personId);
  if (!person) return;
  for (const fact of listMemory({ personId })) {
    if (fact.status !== "established") continue;
    indexUpsert({
      kind: "memory",
      refId: fact.id,
      projectId: null,
      title: person.name,
      content: fact.content,
      sourceDate: fact.created_at,
    });
  }
}

export function setPersonStatus(id: string, status: Person["status"]): Person | null {
  db.prepare(`UPDATE people SET status = ?, updated_at = ? WHERE id = ?`).run(status, nowIso(), id);
  const person = getPerson(id);
  if (person) reindexPerson(person);
  return person;
}

// Hard delete, and it has to be real. This is the first Magi feature whose
// subject is other people, so "delete" cannot mean "hidden but still
// retrievable": the person's facts, their associations, and every search_index
// / embeddings / chunks row all go.
//
// Note the order and the route: facts are removed through deleteMemory (which
// calls indexRemove) *before* the person row is deleted. Deleting the parent
// first and unindexing afterwards is exactly the deleteConversation bug — the
// cascade takes the rows away and the query that was meant to find them for
// unindexing returns nothing, leaving them searchable forever.
export function deletePerson(id: string) {
  for (const fact of listMemory({ personId: id })) deleteMemory(fact.id);
  db.prepare(`DELETE FROM project_people WHERE person_id = ?`).run(id);
  db.prepare(`DELETE FROM people WHERE id = ?`).run(id);
  indexRemove("person", id);
}

// Merging is always a manual, confirmed action — never something inferred.
// Everything the source knew moves to the target, and the source's name joins
// the target's aliases so the merge is itself recorded as a matching rule.
export function mergePeople(sourceId: string, targetId: string): Person | null {
  if (sourceId === targetId) return getPerson(targetId);
  const source = getPerson(sourceId);
  const target = getPerson(targetId);
  if (!source || !target) return null;

  const aliases = [...new Set([...target.aliases, source.name, ...source.aliases])].filter(
    (a) => a.toLowerCase() !== target.name.toLowerCase()
  );

  const move = db.transaction(() => {
    db.prepare(`UPDATE memory SET person_id = ? WHERE person_id = ?`).run(targetId, sourceId);
    // A person can already be on a Project the other was also on; the primary
    // key makes that a conflict rather than a duplicate, so the loser is
    // dropped rather than failing the merge.
    db.prepare(
      `UPDATE OR IGNORE project_people SET person_id = ? WHERE person_id = ?`
    ).run(targetId, sourceId);
    db.prepare(`DELETE FROM project_people WHERE person_id = ?`).run(sourceId);
    db.prepare(`DELETE FROM people WHERE id = ?`).run(sourceId);
  });
  move();
  indexRemove("person", sourceId);

  const merged = updatePerson(targetId, { aliases })!;
  // Facts that moved were indexed under the source's name.
  reindexFacts(targetId);
  return merged;
}

// ---------------------------------------------------------------------------
// Facts — memory rows, reached through the person rather than the Memory page.

export function listPersonFacts(personId: string): MemoryItem[] {
  return listMemory({ personId });
}

export function addPersonFact(input: {
  personId: string;
  content: string;
  status?: MemoryItem["status"];
  source?: string;
  closureId?: string | null;
  sourceMessageId?: string | null;
  sourceConversationId?: string | null;
}): MemoryItem {
  return createMemory({
    scope: "person",
    personId: input.personId,
    content: input.content,
    status: input.status,
    source: input.source,
    closureId: input.closureId,
    sourceMessageId: input.sourceMessageId,
    sourceConversationId: input.sourceConversationId,
  });
}

// ---------------------------------------------------------------------------
// Project association — a relationship, not a scope. A person is global; being
// on a Project is one more thing that is true about them.

export interface PersonProject {
  project_id: string;
  person_id: string;
  role: string | null;
  status: "established" | "suggested";
  created_at: string;
}

export function associate(
  projectId: string,
  personId: string,
  role?: string | null,
  opts: { status?: PersonProject["status"]; closureId?: string | null } = {}
) {
  db.prepare(
    // On conflict the existing status is deliberately left alone: an
    // association the user already established must not be quietly demoted to
    // "proposed" because a closing mentioned the same person again. COALESCE
    // on the role protects a role the user typed from being erased by a caller
    // that had none to offer.
    `INSERT INTO project_people (project_id, person_id, role, status, closure_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(project_id, person_id) DO UPDATE SET role = COALESCE(excluded.role, project_people.role)`
  ).run(projectId, personId, role ?? null, opts.status ?? "established", opts.closureId ?? null, nowIso());
}

// Keeping a proposed association is the deliberate act that puts someone on
// the roster the model actually sees.
export function setAssociationStatus(projectId: string, personId: string, status: PersonProject["status"]) {
  db.prepare(`UPDATE project_people SET status = ? WHERE project_id = ? AND person_id = ?`).run(
    status,
    projectId,
    personId
  );
}

export function dissociate(projectId: string, personId: string) {
  db.prepare(`DELETE FROM project_people WHERE project_id = ? AND person_id = ?`).run(projectId, personId);
}

export function listProjectsForPerson(
  personId: string
): Array<{ id: string; name: string; role: string | null; status: PersonProject["status"] }> {
  return db
    .prepare(
      `SELECT p.id, p.name, pp.role, pp.status
       FROM project_people pp JOIN projects p ON p.id = pp.project_id
       WHERE pp.person_id = ? ORDER BY p.name COLLATE NOCASE ASC`
    )
    .all(personId) as Array<{ id: string; name: string; role: string | null; status: PersonProject["status"] }>;
}

export interface ProjectPerson extends Person {
  role: string | null;
  // The association's own state, which is separate from the person's. A person
  // established months ago can be a *proposed* member of this Project.
  association_status: PersonProject["status"];
}

export function listPeopleForProject(projectId: string): ProjectPerson[] {
  const rows = db
    .prepare(
      `SELECT pe.*, pp.role, pp.status AS association_status
       FROM project_people pp JOIN people pe ON pe.id = pp.person_id
       WHERE pp.project_id = ? ORDER BY pe.name COLLATE NOCASE ASC`
    )
    .all(projectId) as Array<PersonRow & { role: string | null; association_status: PersonProject["status"] }>;
  return rows.map((r) => ({ ...hydrate(r), role: r.role, association_status: r.association_status }));
}

// The roster that reaches a system prompt. Both halves must be established:
// a suggested person is inert everywhere, and a proposed association is an
// inference about *this Project* that nobody has agreed to yet. Anything less
// strict here would put a guess into every turn of the Project.
export function listProjectRoster(projectId: string): ProjectPerson[] {
  return listPeopleForProject(projectId).filter(
    (p) => p.status === "established" && p.association_status === "established"
  );
}

// ---------------------------------------------------------------------------
// Export — the honest answer to "what does your app know about me?"

export interface PersonExport {
  magiPersonExportVersion: 1;
  exportedAt: string;
  person: {
    name: string;
    aliases: string[];
    relationship: string | null;
    summary: string | null;
    status: Person["status"];
    createdAt: string;
  };
  facts: Array<{
    content: string;
    status: MemoryItem["status"];
    learnedOn: string;
    // Where the claim came from, in the user's terms rather than as an id.
    source: string | null;
  }>;
  projects: Array<{ name: string; role: string | null }>;
}

export function exportPerson(id: string): PersonExport | null {
  const person = getPerson(id);
  if (!person) return null;
  const facts = listMemory({ personId: id });
  const conversationTitles = new Map(
    (
      db
        .prepare(`SELECT id, title FROM conversations`)
        .all() as Array<{ id: string; title: string }>
    ).map((c) => [c.id, c.title])
  );
  return {
    magiPersonExportVersion: 1,
    exportedAt: nowIso(),
    person: {
      name: person.name,
      aliases: person.aliases,
      relationship: person.relationship,
      summary: person.summary,
      status: person.status,
      createdAt: person.created_at,
    },
    facts: facts.map((f) => ({
      content: f.content,
      status: f.status,
      learnedOn: f.created_at,
      source: f.source_conversation_id ? conversationTitles.get(f.source_conversation_id) ?? null : null,
    })),
    projects: listProjectsForPerson(id).map((p) => ({ name: p.name, role: p.role })),
  };
}

// ---------------------------------------------------------------------------
// Mentions — the part that works on day one.

// Passages from anywhere in the archive that mention this person. This needs no
// extraction and no prior curation: everything already written is already
// indexed, so a person created this afternoon immediately has a history.
//
// Their own record and their own facts are filtered out. Both would match by
// construction (the record *is* their name; a fact is titled with it), and both
// are already on the page above this section — a "mention" that is just the
// page quoting itself back is noise.
// Drops the un-kept people and associations a conversation's previous closing
// proposed, so redrafting replaces its proposal instead of piling a second copy
// on top. Facts are not handled here — they are memory rows, and
// clearSuggestedForConversation() already covers them.
//
// The exception matters: a suggested person whose facts the user has *already
// kept* is left alone. Deleting them would take those established facts with
// them, which is the same class of bug as a redraft deleting a kept decision.
export function clearSuggestedPeopleForConversation(conversationId: string) {
  const rows = db
    .prepare(
      `SELECT p.id FROM people p
       JOIN episode_closures c ON c.id = p.closure_id
       WHERE c.conversation_id = ? AND p.status = 'suggested'`
    )
    .all(conversationId) as { id: string }[];
  for (const row of rows) {
    const hasKeptFacts = listMemory({ personId: row.id }).some((f) => f.status === "established");
    if (!hasKeptFacts) deletePerson(row.id);
  }
  db.prepare(
    `DELETE FROM project_people WHERE status = 'suggested' AND closure_id IN (
       SELECT id FROM episode_closures WHERE conversation_id = ?
     )`
  ).run(conversationId);
}

// Everything one episode closing proposed about people: the people it proposed,
// and — for people it recognized from the roster and merely learned something
// new about — those people too, each with the facts from this closing. That
// second case is why this is not simply "people with this closure_id".
export function listPeopleForClosure(closureId: string): Array<{ person: Person; facts: MemoryItem[] }> {
  const ids = new Set(
    (
      db.prepare(`SELECT id FROM people WHERE closure_id = ?`).all(closureId) as Array<{ id: string }>
    ).map((r) => r.id)
  );
  for (const row of db
    .prepare(`SELECT DISTINCT person_id AS id FROM memory WHERE closure_id = ? AND person_id IS NOT NULL`)
    .all(closureId) as Array<{ id: string }>) {
    ids.add(row.id);
  }
  const out: Array<{ person: Person; facts: MemoryItem[] }> = [];
  for (const id of ids) {
    const person = getPerson(id);
    if (!person) continue;
    out.push({
      person,
      facts: listMemory({ personId: id }).filter((f) => f.closure_id === closureId),
    });
  }
  return out.sort((a, b) => a.person.name.localeCompare(b.person.name));
}

// ---------------------------------------------------------------------------
// Lookup — what the lookup_person tool returns.

export interface PersonLookup {
  person: Person;
  facts: MemoryItem[];
  projects: Array<{ id: string; name: string; role: string | null }>;
  mentions: RetrievedChunk[];
}

// Established facts only. A suggestion is inert everywhere, and a tool result
// is a route into the model's context like any other — "the user hasn't agreed
// this is true yet" is not a caveat worth trusting a model to carry.
export async function lookupPerson(name: string, mentionLimit = 5): Promise<PersonLookup | null> {
  const person = findPersonByName(name);
  if (!person || person.status !== "established") return null;
  return {
    person,
    facts: listMemory({ personId: person.id }).filter((f) => f.status === "established"),
    projects: listProjectsForPerson(person.id).filter((p) => p.status === "established"),
    mentions: await listPersonMentions(person, mentionLimit).catch(() => []),
  };
}

export async function listPersonMentions(person: Person, limit = 20): Promise<RetrievedChunk[]> {
  const names = [person.name, ...person.aliases].filter((n) => n.trim().length > 0);
  if (!names.length) return [];
  const ownFacts = new Set(listMemory({ personId: person.id }).map((f) => f.id));

  // Over-fetch, because the filter below discards a lot for a rarely-mentioned
  // person and the shortfall has to come from somewhere.
  const chunks = await retrieveChunks(names.join(" "), { limit: limit * 4 });

  return chunks
    .filter((c) => !(c.kind === "person" && c.refId === person.id))
    .filter((c) => !(c.kind === "memory" && ownFacts.has(c.refId)))
    // A mention has to actually mention them. Retrieval's semantic half has no
    // relevance floor — it ranks every passage in the archive and always
    // returns a full pool — so without this a person named in three places
    // showed twenty "mentions", most of them other people's names and
    // character descriptions that merely sat nearby in embedding space. That is
    // worse than showing nothing: the heading promises passages that mention
    // them, and the user has no way to tell which twelve are noise.
    //
    // The cost is real and accepted: a passage that refers to someone without
    // naming them ("the SVP", "his boss") is not found. Retrieval could not
    // reliably find those anyway, and claiming them would be the same dishonesty
    // in the other direction.
    //
    // One related limitation worth knowing: retrieval's keyword half drops
    // terms of two characters or fewer, so an alias like "KB" finds nothing on
    // its own. Aliases of three characters or more work normally.
    .filter((c) => mentionsAnyName(c.content, names))
    .slice(0, limit);
}

function mentionsAnyName(content: string, names: string[]): boolean {
  return names.some((name) => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}([^\\p{L}\\p{N}]|$)`, "iu").test(content);
  });
}
