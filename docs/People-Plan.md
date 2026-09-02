# People — implementation plan

> Status: **complete — all three phases shipped 2026-09-02**, except §8.3, which the user deliberately
> deferred (see §11). Written 2026-09-02, after the
> retrieval / lifecycle / provenance / composition / trajectory / test work described in
> [`Handoff.md`](Handoff.md). Read that first — this plan assumes all of it exists and reuses most of it.
>
> What was actually built is in `Handoff.md` under **People — phase 1 (the rolodex)**, **phase 2 (Magi
> participates)**, and **phase 3 (the connective payoff)**. The §11 open questions are answered in §11
> below; the one §7.1 left undecided was settled while building phase 2 (see the note there); and
> building §8.2 turned up a real pre-existing bug in `trajectory.ts` — recorded in §8.2 below and in the
> Handoff.

---

## 1. What this is

An advanced rolodex: the people connected to the user's work, what is known about each of them, and
where that knowledge came from.

The user's stated problem is plain — *"I'm terrible at remembering details about other people's
lives."* The value is not contact management. It is **what you know about someone and where you
learned it**, which is Magi's existing strength aimed at a new subject.

It fits the Vision's thesis unusually well. Magi claims to be the durable layer above replaceable
models; people are exactly the kind of durable, cross-cutting entity that models forget and that
fragments across conversations. A colleague mentioned across six conversations in three Projects
currently exists only as scattered messages.

### The payoff feature

Everything below builds toward one thing that no chat product can do: **"you're working on X — you
talked to someone last spring who cares about exactly this."** That is only possible because passages
are now dated, retrievable, and attributed. Build the boring parts first, but build them knowing
that's where they're going.

---

## 2. Non-goals — read these before designing anything

This feature has an obvious gravitational pull toward CRM. Resist it. The following are explicitly
**out of scope**, and a change that adds one should be rejected:

- Contact details, phone numbers, email addresses, address books, or any sync with them.
- Birthdays, reminders, follow-up nudges, calendar integration.
- Social-graph import (LinkedIn, contacts export, etc.).
- **Automatic per-turn extraction of people from conversation.** This is the single most important
  non-goal. See §3.
- Relationship scoring, sentiment tracking, "how is this relationship trending." Unreliable and
  unpleasant.
- Anything that presents inferred information about a person as fact.

If the feature starts to feel like it is managing *relationships* rather than *what you know*, it has
drifted.

---

## 3. Decisions already made

These were settled in discussion. Do not relitigate them without a reason.

### 3.1 People are first-class in the UI, memory-backed in the data

A person gets its own top-level nav item, its own page, its own entity. But **facts about a person are
`memory` rows**, not a parallel `person_facts` table.

Why: the memory substrate already provides `status` (established/suggested), claim-level provenance
(`source_message_id`, `source_conversation_id`), dating, exclusion from prompts while suggested,
exclusion from the *index* while suggested, and a review UI. A parallel table would duplicate all of
it, and would duplicate it slightly wrong.

### 3.2 Nothing Magi infers is ever established

Every person and every fact that Magi proposes arrives as `status = 'suggested'`. The user promotes
it. This is the same posture memory already takes, and it matters more here, not less: silently
accumulating claims about third parties is a different thing from remembering facts about yourself.

This single decision also happens to defuse the two worst failure modes below.

### 3.3 Extraction happens at episode close or on demand — never per turn

Per-turn extraction is expensive on every turn, and it is the automatic-memory anti-pattern the Vision
explicitly rejects. The natural hook is the existing episode-closing pipeline
(`src/lib/episodeClose.ts`), which already reads a whole conversation and proposes things for review.
Adding a People section there is a small change to a prompt and a parser that are already tested.

### 3.4 People are global, not Project-scoped

A person crosses Projects — that is the entire point. Association with a Project is a separate,
many-to-many relationship, not a scope.

---

## 4. The two failure modes that will actually happen

### 4.1 The encyclopedia problem

The user has Projects called *History of Technology* and *Movies and Culture Course*. Naive extraction
turns Turing, Comte, and McLuhan into rolodex entries, and the feature becomes useless within a week.

**Mitigation.** The extraction prompt must draw the distinction explicitly: *people the user has a
real relationship with — colleagues, clients, collaborators, family — not historical figures, public
figures, authors, or characters discussed as subject matter.* Add a test for this: seed a conversation
about a historical figure and assert nothing is proposed.

### 4.2 Ambiguity and wrong merges

Two people with the same first name; a colleague named Keith and a Keith quoted in a source document.
A wrong merge in a rolodex is worse than a miss, because the user will act on it.

**Mitigation.** No fuzzy matching, ever. Matching is against an explicit `aliases` list on the person
record. At extraction time the model is given the existing roster and asked to match by exact
name/alias or propose a *new* person — never to guess that two names are the same human. Merging two
people is a manual action with a confirmation.

---

## 5. Schema

All additions. Nothing existing changes shape.

```sql
CREATE TABLE IF NOT EXISTS people (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  aliases TEXT NOT NULL DEFAULT '[]',        -- JSON array of exact alternates
  relationship TEXT,                          -- "colleague at Acme", "client", "daughter"
  summary TEXT,                               -- one line, user-editable
  status TEXT NOT NULL DEFAULT 'established', -- established | suggested
  closure_id TEXT,                            -- which episode closing proposed them
  source_conversation_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS project_people (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  person_id  TEXT NOT NULL REFERENCES people(id)   ON DELETE CASCADE,
  role TEXT,                                  -- "client contact", "reviewer"
  created_at TEXT NOT NULL,
  PRIMARY KEY (project_id, person_id)
);

CREATE INDEX IF NOT EXISTS idx_people_status ON people(status);
CREATE INDEX IF NOT EXISTS idx_project_people_person ON project_people(person_id);
```

Plus one migrated column, via the existing `addColumnIfMissing` pattern in `src/lib/db.ts`:

```
addColumnIfMissing("memory", "person_id", "TEXT");
```

and `memory.scope` gains a third value, `'person'`.

### Why extending `memory.scope` is safe

Check this before writing code — it is the property the whole design rests on. `listMemory()` in
`src/lib/repo/memory.ts` currently reads:

- `scope: 'global'` → `WHERE scope = 'global'`
- `projectId` → `WHERE (scope = 'project' AND project_id = ?) OR scope = 'global'`

Neither clause matches `scope = 'person'`. So person facts **cannot leak into the global or Project
memory blocks of the system prompt** by accident. They reach a prompt only by the deliberate routes in
§7. Add a test asserting exactly this.

---

## 6. Phase 1 — the rolodex

This is the phase that solves the user's stated problem. Ship it before anything else, and it is
useful on its own even if phases 2 and 3 never happen.

### Files

| File | What |
|---|---|
| `src/lib/db.ts` | Schema above |
| `src/lib/repo/people.ts` | `listPeople`, `getPerson`, `createPerson`, `updatePerson`, `setPersonStatus`, `deletePerson`, `mergePeople`, `listPersonFacts`, `addPersonFact`, `listProjectsForPerson`, `listPeopleForProject`, `associate`, `dissociate` |
| `src/lib/searchIndex.ts` | Add `"person"` to `SearchKind` |
| `src/lib/sourceLinks.ts` | `person` → `/people/{id}`; and `memory` rows with a `person_id` should link to their person, not to `/memory` |
| `src/app/api/people/route.ts` | GET list, POST create |
| `src/app/api/people/[id]/route.ts` | GET, PATCH, DELETE |
| `src/app/api/people/[id]/facts/route.ts` | GET, POST |
| `src/app/people/page.tsx` + `PeopleClient.tsx` | List, add, edit |
| `src/app/people/[id]/page.tsx` + `PersonView.tsx` | Detail |
| Sidebar nav | Add **People** |

### Indexing

Index the person record itself as `kind: "person"`, with `name + relationship + summary` as content —
small, so it produces one passage. Facts index as `kind: "memory"` exactly as they already do, and
inherit the existing rule that suggested items are not indexed.

Do **not** index a person's facts into the person record as well. That double-counts them in
retrieval and inflates trajectory counts.

### The person detail page

Three sections, in this order:

1. **What I know** — established facts, each with its date and a link to the message it came from
   (this is item 3's machinery, already built). Suggested facts appear separately with Keep/discard,
   mirroring the Memory page.
2. **Mentions** — passages from across the archive that mention this person, via
   `retrieveChunks(name + aliases, { limit: 20 })`. This is where the feature earns its keep on day
   one: it works retroactively on everything already in the archive, with no extraction needed.
3. **Projects** — associations, with the ability to add and remove.

### Verification

The suite (`npm test`) plus: create a person by hand, add two facts, confirm the mentions section
finds real passages from existing conversations, and confirm the source links land on the right
message.

---

## 7. Phase 2 — Magi participates

### 7.1 Project roster in the system prompt

In `buildSystemPrompt` (`src/lib/contextBuilder.ts`), when the Project has associated people, inject a
bounded roster:

```
## People on this Project
- Keith — client contact at Acme. Runs the review process.
- Syl — colleague. Delivers the live sessions.
```

Name, relationship, one-line summary only. **Cap it** (suggested: 12 people, then "…and N more") —
this is a per-turn cost on every turn in that Project. Established people only.

Their *facts* are not injected.

> **Settled while building phase 2: `lookup_person` is the only route to a person's facts, and the
> retrieval idea below was dropped deliberately.**
>
> The original plan said facts would reach the model through retrieval, since they are indexed — so the
> model would get the facts relevant to the actual question rather than all of them. That never worked
> and was never going to without a change: person facts are indexed with `project_id = null`, and
> `buildSystemPrompt()` scopes retrieval to `familyProjectIds()`, so its `project_id IN (…)` clause
> excludes them.
>
> Rather than widen that clause, the user chose the tool as the sole route. It is cheaper (no extra
> per-turn query), more predictable, and it preserves something better than the original design: nothing
> about a person enters a turn unless the model asks for it by name. The roster says who exists; the
> tool says what is known. Verified live — a real model asked about someone called `lookup_person`
> unprompted and answered only from what was recorded.

Record it in `ContextProvenance` (`peopleOnProject: number` or similar) so the Context panel can show
it, consistent with every other context source.

### 7.2 A `lookup_person` tool

In `src/lib/tools/registry.ts`, alongside `search_archive` and `trace_thinking`. Takes a name; returns
the person's relationship, summary, established facts with dates, and their most relevant mentions.
Update the persona block in `contextBuilder.ts` to point at it, the way `trace_thinking` is.

### 7.3 Extraction at episode close

`src/lib/episodeClose.ts` already parses labelled sections inside `<<<CLOSEOUT>>>` delimiters and has
tests for that parser. Add a sixth section:

```
People:
One line per person who is genuinely connected to the user's work and was discussed here, as
"Name — what was learned about them." Only real working relationships — colleagues, clients,
collaborators, family. NOT historical figures, authors, public figures, or people who are the
subject matter rather than participants. Write "None." if there are none.
```

Give the model the existing roster in the user-message so it can match against known people by exact
name or alias. Parse into: existing person → new suggested fact; unknown name → new suggested person
*plus* a suggested fact.

Everything lands `suggested`. The existing `EpisodeClosePanel` gets a fourth review section.

### 7.4 People on the Project dashboard

Add people to the **Where the work stands** band (`src/components/ProjectStanding.tsx`), or as a small
section beside it. Suggested associations get the same always-visible Keep/discard treatment the
proposals already have.

### Verification

Extend `tests/integration/pipelines.test.ts`: a closing whose reply contains a People section produces
suggested people and facts; a closing that mentions a historical figure produces none; a person
already in the roster gets a new fact rather than a duplicate person.

---

## 8. Phase 3 — the connective payoff

Do not start this until phases 1 and 2 are in real use, because its quality depends entirely on there
being real people with real facts.

### 8.1 "Who might be interested in this?"

From a Project (or an artifact, or a conversation), find people whose known interests, work, or past
mentions genuinely relate. `src/lib/connections.ts` is the same shape — investigate, ground in
retrieved material, and **report "nobody obviously" rather than manufacture a link**. That instruction
already exists in the Connections prompt and should be copied verbatim in spirit.

Output a finding per person with its evidence, promotable into a note or memory item.

### 8.2 Person trajectory

`traceTrajectory(person.name + aliases)` gives "how has my work with X developed" for free, because
passages are dated. Surface it on the person page as an **Over time** tab reusing the Archive page's
timeline component.

> **It was not free — it was broken, and building this found the bug.** Two things had to be fixed
> first, both pre-existing and both invisible to the test suite (which runs with no embedding model, so
> the semantic half of retrieval is always empty there):
>
> 1. **Every trajectory reported `POOL_SIZE`.** The semantic half has no relevance floor — cosine
>    similarity ranks every passage in the archive — so it always returns a full pool however unrelated
>    the query. `totalPassages: Math.max(counts.total, dated.length)` therefore reported 240 for
>    *anything*. Verified against the real archive: `"zzzznothing"` reported the same 240 passages as a
>    real topic, with invented periods. Periods are now created only by the keyword counts; pooled
>    passages illustrate periods that lexically exist, and never create one.
> 2. **The bars summed to more than the total.** Each period's count was `max(keyword count, size of
>    that period's slice of the pool)`, so the chart claimed 223 passages while the header said 150. It
>    now compares against the passages actually *shown* (at most three), which is what the guard was
>    always meant to do, and the header is the sum of the bars by construction.
>
> Also: a person's own rolodex record is excluded from their timeline. It is indexed under their name
> and dated when it was written, so leaving it in put a false point at "today" on the end of every
> person's history.

### 8.3 Outstanding with a person

Reuse the `project_notes` shape — a `person_id` on notes, or a parallel concept — for "what's open
with X." Only worth building if the user actually wants it; ask before assuming.

> **Asked, and deferred.** The user chose not to build it. It is the least certain of the three, and it
> is the closest to the task-tracking gravity §2 warns about. Nothing in the schema blocks adding it.

---

## 9. Privacy and data handling

This is the first Magi feature whose subject is other people. It needs a slightly higher standard than
the rest of the app.

- **Hard delete must be real.** Deleting a person deletes their facts, their associations, and their
  `search_index` / `embeddings` / `chunks` rows. Follow `indexRemove()`, not raw SQL — the
  `deleteConversation` bug in Handoff §"A test layer" is exactly this mistake. Add a test asserting a
  deleted person is not retrievable.
- **Export a person.** A single-person export (their record plus facts plus sources) is cheap and is
  the right answer to "what does your app know about me."
- **Say so in the User Guide.** A short, honest paragraph: what Magi stores about people, that it only
  ever proposes, that it stays local, and how to delete it.
- **Portability.** `src/lib/portability.ts` handles Project export/import. Decide deliberately whether
  people travel with a Project export — probably **not**, since people are global and a Project export
  is shareable. Whichever way, make it explicit rather than accidental.

---

## 10. Testing

Follow the existing structure — `tests/unit`, `tests/repo`, `tests/integration` — and the helpers in
`tests/helpers/`. Remember to add `people` and `project_people` to the `TABLES` list in
`tests/helpers/reset.ts`, child-first, or every test after the first will be polluted.

Minimum bar before calling any phase done:

| Test | Why |
|---|---|
| Person round-trip: create, alias, update, delete | Baseline |
| Deleting a person removes their index and chunk rows | The `deleteConversation` class of bug |
| Suggested people/facts never appear in a system prompt | The invariant the whole design rests on |
| `scope='person'` memory does not appear in the global or Project memory blocks | §5 safety property |
| Episode close proposes people as suggested, matches known people by alias, and proposes nothing for a historical figure | §4.1 and §4.2 |
| Project roster injection is capped | Prompt bloat |
| A person's mentions section returns real passages | Phase 1's actual value |

---

## 11. Open questions — answered 2026-09-02

All four were put to the user before phase 1 was built. These are decisions now, not questions.

1. **Do person facts appear on the Memory page too, or only on the person page?** — **Both.** The
   person's page is where facts are managed; the Memory page gained a **People** section so it remains
   the one place that shows everything Magi holds. Built.
2. **Hard delete or archive?** — **Hard delete, with a confirmation.** `deletePerson()` removes the
   person, their facts, their associations, and every index / embedding / passage row. Built and
   verified against the live database.
3. **Should a person carry a photo?** — **No, not for now.** Phase 1 is textual. Nothing prevents adding
   it later: a `data/people/` directory mirroring `data/images/` plus one `addColumnIfMissing`.
4. **Do people travel with a Project export?** — **No, deliberately.** A Project export is a file the
   user may share, and what they know about third parties is not part of it. The `scope === 'project'`
   filter in `exportProject()` enforces it and now says so in a comment. A single-person export
   (`exportPerson()`, `GET /api/people/[id]/export`) is the answer instead.

---

## 12. Suggested first commit

Small, and proves the substrate before any UI exists:

1. Schema in `db.ts` (`people`, `project_people`, `memory.person_id`).
2. `src/lib/repo/people.ts` with create/get/list/update/delete and fact attachment.
3. `"person"` added to `SearchKind`, and `sourceLinks.ts` handling it.
4. `tests/repo/people.test.ts` covering the round-trip, the delete-removes-index case, and the
   `scope='person'` isolation property.

If those tests pass, the rest of phase 1 is UI over a known-good foundation.
