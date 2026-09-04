# Magi — Engineering Handoff

For whoever (human or agent) picks this up next. Written after the session that built tool use,
Agents, the OpenRouter provider, the Image Lab, cross-Project Connections, and a round of
model-agnosticism hardening driven by live testing across six real models from five vendors.

Read [`Product Vision.txt`](Product%20Vision.txt) first if you haven't — it's the spec this whole
project is working toward, and it explicitly permits building "a small subset" first with the
architecture anticipating the rest. Read [`User Guide.md`](User%20Guide.md) second for what the app
actually does today from the outside.

---

## TL;DR

Every architecturally distinct piece named in the Product Vision now has at least a working, live-tested
subset: Projects, memory, archive, Skills, Councils, Agents, a real tool layer, multi-provider models
(Anthropic direct + OpenRouter proxying most of the industry), an Image Lab, Project export/import, and
cross-Project connection discovery. What's missing is *depth* within those (see "What's not built" below),
not missing pieces. There is no automated test suite — everything has been verified by hand, live, against
real model providers, during development. That's a real gap for whoever continues this.

---

## Tech stack

- **Next.js 16 (App Router) + TypeScript**, Turbopack. Server Components for read paths where
  convenient (direct `better-sqlite3` calls, no API round-trip needed); API routes for mutations and
  anything needing streaming.
- **SQLite** via `better-sqlite3`, local-first. One file: `data/magi.db`. Generated images live as
  actual files under `data/images/`, referenced by path — not blobbed into SQLite.
- **Tailwind CSS v4**, custom design tokens (no default theme) implementing "Instrumental Futurism" —
  see `src/app/globals.css` for the full palette/typography system.
- **`@anthropic-ai/sdk`** for the Anthropic provider; **`openai`** npm SDK pointed at OpenRouter's
  `baseURL` for the OpenRouter provider (OpenRouter is OpenAI-API-compatible for chat completions).
- No test framework is installed. No CI. This is a personal local-first app; testing has been manual —
  see "How this was actually tested" below.

---

## Directory map

```
docs/                        Product Vision.txt, User Guide.md, this file
workers/
  codeExecWorker.mjs           Plain JS (not TypeScript) — run_python/run_javascript's actual
                                sandboxed execution, loaded by node:worker_threads via a filesystem
                                path, never through Next's bundler. See src/lib/tools/codeExec.ts.
src/
  app/
    api/                      All mutation/streaming endpoints, one folder per resource
    projects/[id]/            Project dashboard (ProjectDashboard.tsx) + conversation view
    agents/runs/[id]/         Agent run viewer (polls, live)
    connections/runs/[id]/    Connection run viewer (polls, live)
    councils/, councils/runs/[id]/
    image-lab/                Image Studio UI (single client component, ImageLabClient.tsx)
    archive/, memory/, skills/, settings/
    layout.tsx                 Root shell: fonts, WorkspaceShell (sidebar + command palette + status bar)
  components/
    shell/                    Sidebar, CommandPalette, StatusBar, WorkspaceShell, theme
    ui.tsx                     Shared primitives (Button, Panel, Input, Textarea, Tag, EmptyState...)
    icons.tsx                  Hand-drawn geometric icon set, no icon library
  lib/
    db.ts                      SQLite connection + full schema (single SCHEMA string, CREATE TABLE IF NOT EXISTS)
    models/
      types.ts                 ModelProvider interface, CompleteOptions, ModelCapabilities, ROLE_REASONING_EFFORT
      anthropic.ts             Anthropic provider adapter
      openrouter.ts            OpenRouter provider adapter + image generation + capability caching
      registry.ts               Provider list, role→model assignment, default-picking logic
    repo/                      One file per entity: projects, conversations, memory, documents,
                                artifacts, skills, councils, agents, connections, images, styleGuides,
                                characters, attachments. Thin wrappers over better-sqlite3 + search index upkeep.
    files/
      extractText.ts             PDF/DOCX/plain-text extraction, shared by Documents and attachments
      markdownToDocx.ts           Markdown -> mdast -> real docx constructs, for the create_docx tool
    tools/
      registry.ts               TOOL_SPECS + executeTool() — the actual tool layer
      calculator.ts             Hand-written arithmetic parser (deliberately not eval())
      webSearch.ts               Tavily-backed web_search/web_fetch (search + page extraction)
      codeExec.ts                 run_python/run_javascript orchestration — spawns workers/codeExecWorker.mjs
    agent.ts                    Agent pipeline (plan→research→draft→critique→revise→artifact)
    council.ts                  Council pipeline (analysis→critique→synthesis)
    connections.ts              Connection discovery pipeline
    contextBuilder.ts            Builds the system prompt + provenance for a conversation turn
    conversationWindow.ts        Recent-turns window + rolling summary of older turns
    episodeClose.ts              "Close this episode" — drafts summary/decisions/questions/memory
    trajectory.ts                Retrieval reorganized by time — "when did I first think about this"
    skillComposition.ts          The §39 seam — resolves a Skill into an executable method
    sourceLinks.ts               (kind, ref_id) → a URL and a human-readable place
        repo/people.ts              People, their facts (memory rows, scope 'person'), Project
                                   association, merge, single-person export, and mentions
    peopleInterest.ts            "Who might be interested in this?" — each person weighed against
                                   one Project, grounded in the archive
      repo/peopleInterest.ts      Its runs and findings
      repo/activity.ts            One UNION over everything a Project accumulates, newest first
      repo/projectNotes.ts        Decisions and open questions (proposed → open/settled/resolved)
      repo/episodes.ts            Episode-closing records
    chunking.ts                  Splits text into passage-sized chunks on paragraph seams
    retrieval.ts                 Passage index + hybrid (semantic ⊕ bm25) retrieval
    vectors.ts                   Float32 BLOB pack/unpack + cosine, shared by both indexes
    portability.ts               Project export/import
    searchIndex.ts               FTS5 wrapper (search_index virtual table)
    settings.ts                  Key-value settings (API keys, feature toggles)
```

---

## What's built (maps to Product Vision sections)

- **§11–13 Projects** — full CRUD, persistent instructions/purpose, dashboard aggregating everything
  below.
- **§14–16 Conversations** — streaming, editorial layout, Skill + model-role selection per turn.
- **§17 Command palette** — ⌘K, searches across all entity types.
- **§18–19 Context transparency & provenance** — the Context panel on a conversation; provenance is
  stored on each assistant message (JSON: instructions used, memory counts, documents used, Skill used,
  tool calls made). **Live tool-status while streaming**: `ModelProvider.stream()` (only consumer:
  `chat/route.ts` — every other caller uses `.complete()`) now yields a small discriminated union,
  `StreamEvent` (`types.ts`) — `{type:"text"}` for actual content, `{type:"tool_start"/"tool_end", name}`
  bracketing each tool-call batch — instead of a plain string. `chat/route.ts` encodes each event as one
  NDJSON line; `ConversationView.tsx` buffers partial lines across reads, parses each complete one, and
  shows "using web_search…" (etc., raw tool name, same posture as the existing "Tools used" provenance
  list) the moment a tool starts rather than showing nothing until the first real text token — verified
  live this was a real, confirmed gap before the fix: `resolveToolCalls()` in both provider adapters runs
  inside a plain `await` with nothing yielded during it, and the old "writing…" label only ever appeared
  once `streamingText` was non-empty. Confirmed live after the fix: the status line appears and clears at
  the right moments for a `run_python` call, and a plain no-tool turn is unaffected.
- **§20–21 Memory** — global + Project-scoped, deliberate promotion only (never automatic).
- **§22–24 Archive & search** — SQLite FTS5 full-text search, plus "Ask my archive" (search + synthesize
  with citations). **§23 semantic search**: the Archive page's "Search" mode now has a Wording/Meaning
  toggle — Meaning embeds the query via OpenRouter (`src/lib/models/openrouter.ts` `embedText()`) and
  ranks stored vectors by cosine similarity, computed in JS over a plain `embeddings` table (brute
  force, not a vector index — appropriate at personal-archive scale). Every write that makes content
  searchable already funnels through one function, `indexUpsert()` (`src/lib/searchIndex.ts`), so
  embedding generation hooks in there once, fire-and-forget, and needed zero changes at any of its
  ~15 call sites. New content is embedded automatically going forward; a "Build index" button in
  Settings backfills everything older. **OpenRouter's `/models` catalog does not list embedding-capable
  models** (confirmed by direct testing — unlike chat/image models), so the embedding-model choice in
  Settings is a short, hand-verified list (`OPENROUTER_EMBEDDING_MODELS`), not a live dropdown.
  Model-facing retrieval was rewired in the pass described under **Retrieval-first context assembly**
  below: `search_archive` and `POST /api/archive/ask` now return real passages from the chunk index and
  fall back to whole-item keyword FTS only when nothing in it matched.
- **Retrieval-first context assembly (§12, §18, §46, §81)** — the fix for the single biggest gap between
  the Vision and the build: a turn used to get each Project document injected in list order until a
  12,000-character budget ran out. On the largest real Project (52 documents, 1.2M characters) that was
  ~1% of the Project's knowledge, chosen by insertion order rather than by relevance to the question.
  Now every indexable item is also split into ~1200-character passages (`chunking.ts`, on paragraph
  seams, sentence-aware hard splits for over-long paragraphs) and stored in a `chunks` table with its
  own vector plus a `chunk_search` FTS5 mirror. `buildSystemPrompt()` is async and takes the turn's
  `query`; it retrieves against it and injects a numbered **Retrieved from this Project** block (24,000
  characters, cited as `[P1]`, `[P2]`), scoped to `familyProjectIds()` — the same boundary
  `search_archive`'s default scope uses, so context assembly and the search tool can't disagree about
  what "this Project" means. A titles-only document inventory is always included as well, so the model
  knows what exists even when a passage from it didn't rank.
  - **Hybrid, not semantic**: embedding similarity and bm25 are run separately and fused by reciprocal
    rank (k=60). Either half works alone — with no embedding model configured this degrades to
    passage-level keyword retrieval rather than to nothing, which is why chunk rows are written
    synchronously on every write and vectors are filled in afterwards. bm25's half deliberately ORs its
    terms: FTS5's default AND is right for a search box and wrong for a whole sentence the user typed.
  - **Caps that matter**: at most 3 passages per source, so one long document can't fill the budget
    just by being long; the semantic half `.iterate()`s and keeps a bounded top-N instead of
    materializing every vector (a personal archive is already ~16k passages, and collecting them all to
    sort would be a nine-figure allocation per turn).
  - **Migration**: `ensureChunkIndex()` builds passages for everything already in `search_index` on
    first use, guarded by a settings flag. It's pure local work — no key, no network — so retrieval
    doesn't wait on the user knowing to press "Build index". Measured on the real database: 2,864 items
    → 16,487 passages in ~1.3s of chunking (~18s including SQLite writes), once. Vectors remain the
    optional second half and are left to the backfill, which now counts both halves into one total.
  - **Falls back, never fails**: retrieval errors and empty results both drop to the old
    head-of-each-document injection, recorded as `provenance.retrievalMode: "retrieval" | "documents" |
    "none"`. `provenance.retrieved[]` carries every passage's kind, title, chunk index, date, match type
    and similarity, and the Context panel lists them — so "what did it actually read?" has an answer at
    passage granularity.
  - **Falls out for free**: `search_archive` and `POST /api/archive/ask` now return passages instead of
    24-token keyword windows, and every chunk carries a `source_date` (threaded through `indexUpsert`'s
    new `sourceDate`, so imported 2023 material is dated 2023, not "indexed today").
  - Verified against the real database through the running server: warm retrieval ~380ms, `retrieval`
    mode on real questions, correct fallback to `documents` mode on a no-match query.
- **Conversation lifecycle (§14, §20–21)** — the Vision calls a conversation an episode, but episodes had
  no lifecycle: nothing closed one, summarized it, or proposed what should survive it, and every turn sent
  the entire history (the largest real conversation is 122 messages / ~890,000 characters — expensive long
  before it becomes impossible). Two halves, both new:
  - **Rolling window** (`conversationWindow.ts`) — a conversation now sends a recent verbatim window
    (40,000 characters, floor of 6 messages so a few enormous turns are never summarized away) plus a
    rolling summary of everything older, injected as an **Earlier in this conversation** block. The fold is
    incremental: `conversations.summary_through_id` records how far the stored summary reached, so each
    turn only re-reads messages added since. Ordinary conversations never summarize anything and behave
    exactly as before. Uses the `fast` role — the fold is a bounded, incremental rewrite, and putting the
    `synthesizer` model on it would mean paying deep-model prices on most turns of every long
    conversation. Never throws: a failed summary sends the whole history, as before.
  - **Close this episode** (`episodeClose.ts`, `EpisodeClosePanel.tsx`) — a deliberate, user-initiated pass
    with the `synthesizer` role that reads the conversation (rolling summary + bounded tail) and drafts a
    summary, the decisions it settled, the questions it left open, and what's worth remembering, split into
    Project-scoped and global. **Nothing it proposes takes effect.** Memory lands as `status='suggested'`
    — which `buildSystemPrompt()` already filters out, so a proposal is inert in every prompt until kept —
    and decisions/questions land in a new `project_notes` table as `status='proposed'`. Proposals are rows,
    not modal state, so they survive dismissing the panel and are reviewable from the Memory page (new
    **Suggested** section) as well as in place. Redrafting replaces un-kept proposals and deliberately
    spares anything already kept.
  - **Two real bugs found and fixed during verification**, both worth knowing about:
    (1) the section parser matched headings with a regex that anticipated decoration, and `**Decisions:**`
    (colon *inside* the bold markers) silently swallowed the whole section into the one above it — now
    headings are recognized by stripping `#*_\`:` and comparing, which is decoration-agnostic;
    (2) `synthesizer` is assigned `deepseek/deepseek-v4-pro-0813` at reasoning effort `high`, and its
    mandatory reasoning landed *in the visible reply*, so proposals like `Is that a decision? Not exactly
    but can be a settled fact...` were stored as memory, and the 2,000-token budget ran out mid-bullet.
    Fixed model-agnostically with explicit `<<<CLOSEOUT>>>`/`<<<END>>>` delimiters (anything outside is
    discarded, so pre-answer reasoning can't parse as content), 6,000 max tokens, an explicit
    no-meta-commentary instruction, and quote-stripping in `bullets()`. Same lesson as the role classifier,
    one layer up: never assume a role's assigned model won't think out loud.
  - `splitWindow()`, `splitSections()`, `bullets()` and `extractDelimited()` are exported specifically
    because they're the testable units here — the natural first targets for the test layer below.
- **Claim-level provenance (§18–19)** — provenance could say *which documents were in play*, never where a
  specific claim came from. Now:
  - **Memory carries its origin.** New `memory.source_message_id` / `source_conversation_id`. The
    "Remember in Project/globally" action records the exact message it was promoted from; an episode
    closing records the conversation (no single message is the origin there). The Memory page shows each
    item's date and a link straight back — and the system prompt now renders every memory bullet as
    `- (2026-08-31, from "Conversation title") …` so the model can answer "where did that come from?"
    from the prompt instead of guessing. Multi-line imported memory has its continuation lines indented
    so the date doesn't appear to caption an unrelated wall of text.
  - **Retrieved passages link to their source.** `sourceLinks.ts` turns an indexed item's `(kind, ref_id)`
    into a URL and a human-readable place ("Field Notes · Refining the opening"), batched one query per
    kind. Resolved when provenance is *written*, not at render time, because provenance is stored JSON
    that outlives the turn. Messages get `#<message id>` fragments; documents and artifacts have no page
    of their own, so they anchor to `#documents` / `#artifacts` on the Project dashboard. An unknown or
    deleted ref resolves to `null` rather than a broken link.
  - **Landing on a linked message.** ConversationView gives each message an `id`, and its
    landing-scroll effect now checks the URL fragment first: a link from the Context panel or a memory
    item scrolls to that message and marks it with an accent rule, instead of jumping to the tail.
  - **A migration recovers old links.** Before these columns existed, origins were stuffed into the
    free-text `source` field — a bare conversation id from the Remember action, `episode:<id>` from a
    closing. Both are parsed back into real `source_conversation_id` values on startup, so existing items
    get working links rather than displaying a raw id. Verified: all 5 episode-proposed items relinked,
    zero raw ids left, the 26 imported items correctly showing just a date.
- **Project as a place (§11–13)** — the dashboard was a stack of section panels: it opened onto a
  Project's *contents*, which is the folder feel the Vision explicitly says to avoid. A **Where the work
  stands** band now sits between the header and the section grid — open questions, decisions, and a
  recent-activity strip — so the first thing a Project tells you is its state, not its inventory.
  - Questions and decisions come from the `project_notes` table built for episode closings. Proposals
    from a closing appear here tagged `PROPOSED` with Keep/discard **always visible** (not hover-gated —
    the band announces "4 proposed by a closed episode", and hiding the action behind a hover would be
    advertising a door with no handle). Notes written by hand skip `proposed` entirely and land as
    `open`/`settled`, because writing one *is* the deliberate act.
  - `repo/activity.ts` is one `UNION ALL` over conversations, documents, artifacts, established memory,
    Agent runs, Council runs, Connections, episode closings, and images. Titles are truncated in SQL so a
    200KB artifact body never crosses the process boundary just to be cut to a line.
  - **A real flaw caught by running it against the live database:** a strictly chronological strip is
    useless, because whichever kind was busiest most recently monopolizes it — the first render on a real
    Project was seven near-identical image generations and nothing else. Fixed the same way retrieval caps passages
    per source: dedupe repeated `(kind, title)` pairs, then allow `MAX_PER_KIND = 3` on a first pass and
    top up chronologically from the overflow. A Project that genuinely only contains documents still
    fills its strip with documents; one with a burst of images shows the burst *and* the conversations.
  - `GET /api/projects/[id]/standing` serves notes and activity together — it's one reading of a
    Project's state, not three widgets that could disagree about when they loaded.
- **The §39 hierarchy composes** — Skills, Agents and Councils were three parallel implementations
  sharing only the model and tool layers: a Skill was a system-prompt block plus a tool allowlist, an
  Agent was one hardcoded five-stage pipeline, and a Council role couldn't reference a Skill at all.
  `skillComposition.ts` is the seam that makes the stack real; everything that can use a Skill resolves
  it through there, so "what does this Skill actually specify?" has one answer instead of three.
  - **A Skill is now a method**: `skills.model_role` (which model the method wants) and `skills.stages`
    (an ordered pipeline of `{name, instructions, modelRole?, useTools?}`). Both null is exactly the
    plain single-pass Skill every existing Skill already is, so nothing changed underneath them.
  - **Agents use Skills.** `runAgent` takes a `skillId`. A Skill *with* stages replaces the built-in
    plan/research/draft/critique/revise pipeline entirely — each stage sees the objective plus everything
    earlier stages produced, and steps are recorded with the new `"stage"` type, named by the Skill. A
    Skill *without* stages still applies: its method is folded into every built-in stage's system prompt.
  - **Council roles use Skills.** `CouncilRole.skillId`. The Skill supplies the method, the role supplies
    who is applying it (`composeSystemPrompt` puts the method first, the role's framing last).
  - **Conversations honour a Skill's model role**, but only when the user left the composer on "Default".
    An explicitly picked role, and a classifier's answer on an Auto turn, both outrank it.
  - **Two invariants worth not breaking.** `preferredRole()`: an explicit caller choice always wins, the
    Skill fills gaps, then a fallback — a Skill is default-bearing, never an override of a deliberate
    choice. `narrowTools()`: allowlists compose by *intersection*, so referencing a Skill can never widen
    an Agent's or a Council role's permissions, matching what `resolveTools()` already does with the
    global disabled list. Both verified directly, including the "cannot widen" case.
  - A `model_role` naming a role that no longer exists degrades to "no preference" rather than a broken
    lookup — `isModelRole()` validates against `MODEL_ROLES` on the way out of the database.
  - Verified end-to-end: a two-stage Skill run through a real Agent produced two `stage` steps named by
    the Skill, with stage 2 demonstrably building on stage 1's output, and saved its artifact. Also
    exercised the failure path — a provider 429 on the first attempt was recorded as an error step and
    set the run to `error`, exactly as intended.
- **Trajectory: "when did I first think about this"** — the question a personal archive can answer and a
  chat product cannot. `trajectory.ts` reorganizes retrieval by time; the **Over time** mode on the
  Archive page and a `trace_thinking` tool both read it, and the persona points models at it for any
  question about time or change.
  - **The naive version is wrong and worth not building.** Taking the top N passages by relevance and
    sorting them by date produces a timeline of whenever the topic was hottest, presented as if it were a
    history — relevance clusters. Instead: a large pool is retrieved, bucketed into periods, and the most
    relevant few kept *within each period*, which guarantees coverage across the whole span. Granularity
    switches from months to quarters past 14 periods.
  - **Counts and passages come from different places, deliberately.** Period counts and the true
    first/last dates come from `matchCountsByDate()` — an uncapped `GROUP BY` over the passage FTS. The
    passages shown are a relevance-ranked sample. Counting the *pool* instead would mean every topic
    reported the pool cap: the first run of this returned `total=240` for every query, because 240 was
    POOL_SIZE. A period can therefore legitimately show a count with no passages, and the UI says so
    rather than rendering an empty period.
  - **Three real bugs found by running it against the live archive**, all of which made the feature
    meaningless rather than merely imperfect:
    1. **Every chunk was dated the day it was indexed.** `ensureChunkIndex` seeded `source_date` from
       `search_index.created_at`, which for everything predating the passage index is one afternoon — so
       every trajectory spanned 2 days. `repairChunkDates()` pulls the real dates from the source tables
       (`messages.created_at` et al.), which recovered **15 months** of actual history.
    2. **Stopwords wrecked the counts.** The lexical half ORs its terms, so "AI in the classroom" matched
       on `the` and reported **14,574** passages. bm25 ranks that noise away for ordinary retrieval, but
       a *count* has no ranking to save it. With a stopword list the same query reports 94 — a readable
       shape with a real nine-month gap in it.
    3. **Orphaned chunks outlive their source.** A chunk whose row was deleted outside the app's own
       delete path (`indexRemove` → `removeChunks`) stays searchable forever and shows up as the topic's
       most recent mention. The date repair now prunes them in the same pass.
  - Narration is opt-in and separate: the timeline is pure retrieval and costs nothing, so "when did I
    first write about X" is free and only "how did it change" spends. The prompt insists on honesty about
    the shape of the evidence — verified live, and it correctly refused to manufacture an arc, concluding
    of one topic that it "never developed — it was *repurposed*", and naming the gap that made a
    development narrative unsupportable.
- **A test layer** — `npm test` (vitest, the only new dependency). 154 tests, ~7 seconds, no network and no
  API key. **Its blind spot is worth knowing**: no embedding model is configured, so the semantic half of
  retrieval is always empty under test. Two real trajectory bugs lived behind exactly that gap (see
  People phase 3) — anything whose behaviour changes once vectors exist has to be checked live. Two small production seams make it possible: `MAGI_DATA_DIR` in `db.ts` (each test file gets a
  throwaway SQLite database via `tests/setup.ts`) and `__setProvidersForTests()` in the model registry.
  - **`tests/helpers/provider.ts`** is the mock provider — it records what it was asked, replies with
    whatever the test queued, and can be told to fail or to request a tool call. That's what makes the
    *pipelines* testable: `buildHistoryWindow`, `draftClosure`, `runAgent` (both the built-in pipeline and
    a Skill's stages), `runCouncilDeliberation`, and `buildSystemPrompt` are all exercised end to end.
  - Structure: `tests/unit` (pure functions), `tests/repo` (round-trips against a real database),
    `tests/integration` (retrieval, and the pipelines). Files run serially — `db.ts` caches its connection
    on `globalThis`, so parallel workers would share one database.
  - Many tests are explicitly labelled regressions for bugs found while building items 1–6: the
    `**Decisions:**` heading that swallowed a section, a reasoning model's deliberation parsing as
    content, counting the retrieval pool instead of the archive, stopwords inflating a count, passages
    dated when they were indexed, a redraft deleting a kept proposal, and an unknown model role breaking
    a lookup.
  - **Two real bugs the suite found on its first run**, both pre-existing and neither visible from
    reading the code:
    1. **`deleteConversation` left every message searchable.** It deleted the conversation row first,
       which cascades the messages away, and only *then* queried for message ids to unindex — so the
       query returned nothing and every message's search, embedding, and passage rows were orphaned. A
       deleted conversation stayed fully searchable and retrievable. Ids are now collected first.
    2. **Suggested memory was reaching prompts through retrieval.** `buildSystemPrompt` correctly filters
       the memory *sections* to `established`, but `createMemory` indexed every item regardless — so a
       proposal from an episode closing was retrievable and got injected as a cited passage. That defeats
       the entire point of a suggestion being inert until kept. Suggestions are no longer indexed;
       promotion indexes, demotion unindexes, and a migration clears the ones already written.
- **People — phase 1 (the rolodex)** — the first Magi feature whose subject is someone other than the
  user. Built to `docs/People-Plan.md`, which is the brief and stays the reference for phases 2 and 3.
  A person is first-class in the UI (`/people`, `/people/[id]`, a sidebar item) and memory-backed in the
  data: **facts about a person are `memory` rows with `scope = 'person'` and a `person_id`**, not a
  parallel table, so they inherit established/suggested status, claim-level provenance, dating, and the
  rule that a suggestion is neither prompted nor indexed — none of which a second table would have got
  right twice.
  - **The safety property everything rests on**: neither branch of `listMemory()` matches
    `scope = 'person'` (global matches `'global'`; the Project branch matches `'project' AND project_id
    = ?` or `'global'`). A person fact therefore *cannot* reach the global or Project memory block of a
    system prompt by accident — only by a route someone deliberately adds. There is a test asserting
    exactly this, and it is the first thing to re-check if the People feature ever starts leaking.
  - **A related consequence worth knowing before phase 2**: person facts are indexed with
    `project_id = null`, and `buildSystemPrompt()` scopes retrieval to `familyProjectIds()`. So they are
    not retrievable into a Project turn today either. Phase 2's claim that "facts reach the model through
    retrieval" needs that scoping widened deliberately (or the `lookup_person` tool to carry them) — it
    will not happen for free.
  - **Matching is never fuzzy.** `findPersonByName()` matches the name or an exact declared alias,
    case-insensitively, and nothing else. `mergePeople()` is a manual, confirmed action that moves facts
    and associations across and folds the loser's name into the survivor's aliases. A wrong merge in a
    rolodex is worse than a miss, because the user acts on it.
  - **Mentions are the day-one value and cost nothing to build**: `listPersonMentions()` is
    `retrieveChunks(name + aliases)` over the existing passage index, so a person added this afternoon
    immediately has 15 months of history. Verified live against the real archive — a person created by
    hand returned real dated passages from two Projects, each linking to the exact message. Their own
    record and their own facts are filtered out; both match by construction and are already on the page.
    - **A mention must actually name them**, and that filter is load-bearing. Found while curating a
      real archive: retrieval's semantic half has no relevance floor, so someone named in three places
      came back with a full twenty "mentions" — twelve of which were other people's names and character
      descriptions sitting nearby in embedding space, under a heading promising the opposite. Passages
      are now kept only if the content matches the name or an alias on a word boundary. Same root cause
      as the two trajectory bugs under phase 3; this is the third place it surfaced.
    - Known limitation, documented at the call site: retrieval's keyword half drops terms of two
      characters or fewer, so an alias like "KB" finds nothing on its own. Three characters or more
      behave normally.
  - **Hard delete is real, and took the `deleteConversation` lesson seriously**: `deletePerson()`
    removes the facts through `deleteMemory()` (→ `indexRemove`) *before* deleting the person row, since
    deleting the parent first and unindexing afterwards is precisely the bug that left every message of
    a deleted conversation searchable. Verified against the live database: after deleting a person,
    `people`, `project_people`, person-scoped `memory`, and their `search_index` / `chunks` /
    `embeddings` / `chunk_search` rows were all zero, with the user's own messages untouched.
  - **A person's facts are titled with their name** in the index (`memoryTitle()` in the memory repo),
    not "person memory" — a bare fact is close to useless without knowing whose it is, and the title is
    what both the embedding and the citation carry. Renaming a person re-titles their facts.
  - **`sourceLinks.ts` gained two kinds**: `person` → `/people/{id}`, and a `memory` row carrying a
    `person_id` now links to its person rather than to the undifferentiated `/memory` page.
  - **Deliberate decisions, recorded so they aren't re-litigated**: hard delete rather than archive; no
    photo for now (`addColumnIfMissing` makes it a later, cheap addition); person facts appear on the
    Memory page under a **People** section as well as on the person's page, so no category of what Magi
    holds is invisible there; and **people do not travel with a Project export** — a Project export is
    shareable, what you know about third parties is not. `exportPerson()` / `GET /api/people/[id]/export`
    is the single-person answer instead.
- **People — phase 2 (Magi participates)** — the roster reaches the prompt, a tool reaches the facts, and
  closing a conversation proposes people. Built to `docs/People-Plan.md` §7.
  - **The roster, not the knowledge.** `buildSystemPrompt()` injects a **People on this Project** block —
    name, relationship, one-line summary, capped at 12 with "…and N more" — and nothing else about
    anyone. It is a per-turn cost on every turn in the Project, so it says who exists and points at
    `lookup_person` for the rest. Recorded as `provenance.peopleOnProject` and shown in the Context panel.
  - **`listProjectRoster()` requires *both* halves established** — the person and the association. This
    is the phase-2 counterpart to phase 1's scope property: a suggested person is inert everywhere, and a
    proposed association is a guess about this Project specifically. `project_people` therefore gained
    its own `status` and `closure_id`, because an association proposed by a closing is itself an
    inference, and being on a roster is exactly the kind of effect an inference must not have.
  - **The §7.1 retrieval idea was dropped, deliberately** (the user chose it; see the note in the plan).
    Person facts are indexed with `project_id = null` and `buildSystemPrompt()` scopes retrieval to
    `familyProjectIds()`, so they were never reachable that way. Instead of widening that clause,
    `lookup_person` is the sole route — cheaper, more predictable, and it preserves a stronger property
    than the original design: **nothing about a person enters a turn unless the model asks for them by
    name.**
  - **`lookup_person`** returns relationship, summary, established facts with dates, Projects, and top
    mentions. Established facts only — a tool result is a route into context like any other, and "the
    user hasn't agreed this is true yet" is not a caveat worth trusting a model to carry. On a miss it
    lists the known names and states plainly that matching is exact, which is what stops a model
    deciding a near-miss must be the same human.
  - **Extraction at episode close** is a sixth `<<<CLOSEOUT>>>` section, using the parser and delimiters
    that were already tested. The prompt carries the encyclopedia guard from §4.1 explicitly (a
    conversation about Turing or McLuhan proposes nobody — "the test is whether the user has a
    relationship with this person, not whether the person was discussed"), and the user message carries
    the existing roster so a known person is matched by exact name or alias instead of duplicated.
    `parsePersonLine()` is exported and unit-tested: it accepts four separators models actually use, and
    **refuses a separator-less line that looks like a sentence** — a model that ignores the format would
    otherwise create a person named after a whole sentence, and junk in a rolodex costs the user cleanup.
  - **Redraft safety, again.** `clearSuggestedPeopleForConversation()` drops un-kept proposed people and
    associations, but **spares a suggested person whose facts the user already kept** — deleting them
    cascades through `deletePerson()` and would take an established fact with them. Same class of bug as
    a redraft deleting a kept decision; there is a test.
  - **`associate()` never demotes or erases.** `ON CONFLICT` leaves the existing status alone and
    `COALESCE`s the role, so a closing that re-mentions someone already on the Project cannot downgrade
    an association the user established or wipe a role they typed.
  - **Verified live against a real model**, which is the only way to check the part tests can't: asked
    about a recorded person, the model called `lookup_person` unprompted and answered only from what was
    recorded; asked about a deliberately near-miss name, it refused to conflate them and suggested adding
    an alias instead. Provenance showed `peopleOnProject: 1` and the tool call. The verification Project,
    conversation and person were deleted afterwards and the database re-checked clean.
- **People — phase 3 (the connective payoff)** — the question the whole feature was built toward, plus
  the timeline that comes free from dated passages. Built to `docs/People-Plan.md` §8; §8.3
  ("outstanding with a person") was put to the user and deliberately deferred.
  - **"Who might be interested in this?"** (`src/lib/peopleInterest.ts`, `people_interest_runs`) weighs
    each established person against one Project — same fire-and-forget + polling shape as Connections,
    a separate table because the question is Project→person rather than Project→Project. Capped at 24
    people, since each is a model call. The prompt inherits the Connections discipline and hardens it:
    "most people will have no real link to most Projects, and saying so is the correct and expected
    answer — a weak, generic link is worse than none, because the user may act on it", plus an explicit
    ban on inferring anything about the person beyond what was recorded. The run view defaults to
    showing only Strong/Moderate findings and says **"Nobody obviously"** when there are none. A finding
    promotes to *Project* memory, not to a fact about the person — it is Magi's judgement, and filing a
    judgement as something "known" about a third party is exactly what §2 forbids.
  - **Person trajectory** — `GET /api/people/[id]/trajectory` traces name + aliases, and the person page
    gets an opt-in **Over time** section. The Archive's timeline was extracted to
    `src/components/TrajectoryTimeline.tsx` and both pages now render the same component, so they cannot
    drift about what a timeline looks like or what its caveats are.
  - **Two real pre-existing bugs in `trajectory.ts`, found by building this against the live archive,
    both invisible to the suite** — the test environment has no embedding model, so the semantic half of
    retrieval is always empty there and neither could reproduce:
    1. **Every trajectory reported `POOL_SIZE`.** The semantic half has no relevance floor (cosine ranks
       every passage), so it always returns a full pool no matter how unrelated the query, and
       `totalPassages: Math.max(counts.total, dated.length)` reported 240 for anything. Confirmed live:
       `"zzzznothing"` reported the same 240 passages as a real topic, with fabricated periods. Periods
       are now created only by `matchCountsByDate`; pooled passages illustrate periods that lexically
       exist and never create one. The same query now correctly reports 0.
    2. **The bars summed to more than the header.** A period's count was `max(keyword count, size of its
       slice of the pool)`, so a real person's chart claimed 223 passages under a header saying 150. It
       now compares against the passages actually shown (≤3), which is what that guard was always for,
       and `totalPassages` is the sum of the periods, so the number and the picture agree by
       construction.
    - The endpoints (`firstDate`/`lastDate`) come from the counts for the same reason: a semantic
      near-miss from 2019 must not become "when I first thought about this".
  - **A person's own record is excluded from their own timeline** — it is indexed under their name and
    dated when it was written, so including it put a false point at "today" at the end of every person's
    history. `SEARCH_KINDS` is now an exported array (the `SearchKind` union derives from it) so
    "everything except one kind" can be expressed without silently excluding future kinds.
  - **Verified live against the real archive and a real model.** The person timeline for someone with 15
    months of history produced a genuine shape — June 59 → July 55 → August 34 → September 3 over 92
    days — with the header and bars agreeing. An interest run over a throwaway Project scored a person
    with real archive presence *Moderate*, citing the Project's own open question and what the archive
    said about them, and scored a person with no relevant history *None*, stating plainly that the
    Project's material "doesn't mention print production, event collateral, or vendors at all" rather
    than reaching for a link. Both searched the archive before answering. Everything created was deleted
    afterwards and the database re-checked clean.
- **People — review pass** (three retrieval fixes, and six changes to People itself).
  - **Retrieval, three findings that everything else sits on:**
    1. **A turn retrieved its own question.** `addMessage()` indexes the user's message before
       `buildSystemPrompt()` runs, and that message is a perfect lexical match for the query — because it
       *is* the query — so it came back as the top passage and spent budget telling the model what the
       user had just said. `RetrieveOptions.excludeRefIds` now threads from both chat routes through
       `runChatTurn`. Regenerate excludes it too, from the message row rather than the windowed history.
    2. **`chunk_search` indexed its own id column.** `fts5(chunk_id, content)` tokenizes ids like
       `message:msg_4f3a…:2` into the same term pool as the prose: searchable as text, and counted into
       the document lengths bm25 normalizes against, quietly distorting every ranking. Now
       `chunk_id UNINDEXED`. FTS5 columns cannot be altered, so existing databases rebuild the table from
       `chunks` — **guarded on the stored schema rather than a settings flag**, since the condition *is*
       the thing being fixed and so can neither run twice nor be skipped by an optimistic flag. Verified
       on the real database: 16,676 passages rebuilt with no loss and ids no longer matchable.
    3. **AI-generated passages were called ground truth.** Retrieved passages include Magi's own earlier
       replies and artifacts, and the block instructed the model to treat all of it as ground truth — so
       a previous answer confirmed itself. Assistant-authored passages are now labelled ("your own
       earlier reply") via one batched role lookup, and the instruction tells the model to weigh passages
       by who produced them and to say so when the only support for a claim is its own earlier reply.
  - **Facts can acquire provenance after the fact.** Typing a fact by hand was the fastest route and the
    only one that lost the link, which left the person page claiming provenance most facts didn't have —
    59 of 59 on the real database. `GET /api/memory/[id]/origin` retrieves against the fact's own text,
    scoped to the person's Projects, and offers candidate messages; the user picks. It proposes and never
    links on its own, because a wrong citation is worse than a missing one. Verified live: the top
    candidate for "Keith has been the main source of friction" was the exact message that said it.
  - **"Remember about a person"** sits beside "Remember in Project" on every assistant message, so the
    linked route into a person fact is available where the fact is actually learned.
  - **Mentions and trajectory are scoped to the person's Projects by default.** Twelve of fifteen real
    people are recorded under a first name, which matched across 16,000 passages from every Project — a
    colleague called Anna collided with Anna Karenina. The scope, the count of what the wider search
    would find, and a toggle are all shown. **With a fallback that matters**: an imported archive puts
    years of material in one catch-all Project nobody is associated with, so scoping found *nothing* for
    two real people — worse than the noise. An empty scoped search widens itself and says it did.
  - **Facts have time semantics.** `memory.status` gains `superseded`, with `superseded_by` /
    `superseded_at`. A superseded fact keeps its text and date as history but is inert everywhere a
    model can reach it — unindexed, absent from `lookup_person`, absent from prompts. A new fact can name
    the one it replaces, so "Beatrix is 8" and "Beatrix is 9" are never both current.
  - **The rolodex cross-links by exact name.** `linkPersonNames()` renders an exact name or alias inside
    a fact, summary, or mention as a link to that person — longest-match-first so "Annette Palalas" wins
    over "Annette". Nothing is stored and nothing is inferred: this is not a relationship graph.
  - **A drafted summary, as a proposal.** `people.suggested_summary` holds it beside the real one with
    Keep/discard. **It used the `fast` role first and that was wrong**: `fast` is `qwen/qwen3.8-flash`,
    the mandatory-reasoning model lesson #9 already names for breaking the role classifier, and it
    returned `10 d? Let's simpler use known length approx…` *as a person's summary*. Fixed the way the
    episode closer was — `<<<SUMMARY>>>` delimiters, so reasoning outside them is discarded — plus the
    `writer` role, since shaped output needs a model that follows the shape. `extractSummary()` is
    exported and unit-tested.
  - **Interest discovery is bounded and priced.** `selectCandidates()` skips anyone with neither an
    association nor a single archive mention — thin material is exactly what produces a manufactured
    link. The Ask button now shows what it will cost (how many of your people, who is being skipped and
    why) before spending it, assessments run four at a time rather than sequentially, and both the
    dashboard and the run view show progress as "n of m".
- **§25–26 Cross-Project intelligence** — `search_archive` tool with a `scope: this_project | all` param
  gated by a Settings toggle (§25), and the standalone Connections feature for proactive discovery (§26).
- **§27–31 Model independence** — provider abstraction (`ModelProvider` interface), two providers live,
  role-based assignment, capability-aware requests. **§31 cost visibility**: every model call (across
  conversations, Agents, Councils, Connections, and archive questions) is logged to a `usage_events`
  table with token counts, surfaced in Settings ("Usage & cost") and the status bar. Cost in dollars is
  automatic for OpenRouter (from its own live pricing catalog); Anthropic exposes no pricing API, so its
  cost only appears once the user enters a rate in Settings — tokens are always shown regardless.
  **§29 automatic model selection**: conversations can be set to "Auto" instead of a fixed role — an
  actual (cheap) classification model call, `classifyModelRole()` in `src/lib/models/registry.ts`, picks
  the best-fit role per turn rather than a keyword heuristic, then falls through the normal
  `modelForRole` path unchanged. Scoped to conversations only: Agent pipeline stages and Council roles
  already get task-appropriate routing by construction (see §38-39/§40-45 below), so a classifier would
  add nothing there. Must never break a turn — any failure (bad reply, no key, network error) falls back
  to `"default"`. **Real bug found and fixed live**: the classifier's first version used `maxTokens: 10`
  and silently misclassified everything as `"default"`, because the assigned "fast" model
  (`qwen/qwen3.8-flash`) has *mandatory* reasoning it can't be told to skip and spent the entire 10-token
  budget on hidden reasoning, never reaching the actual word — the exact failure class already documented
  below under "Lessons learned" #1, now reproduced with a fresh model. Fixed by raising `maxTokens` to
  300 (cost is a fraction of a cent either way) and matching role ids by substring rather than exact
  string equality, since models don't reliably reply with the bare id even when told to.
  **Reasoning effort is now user-configurable**: `role_reasoning_effort` (a table shaped exactly like
  `model_roles`) backs `getReasoningEffortAssignments()`/`setReasoningEffortForRole()` in `registry.ts`;
  Settings → Model roles gets a second dropdown per role, next to the model picker. The previous
  hardcoded `ROLE_REASONING_EFFORT` map is now only the *fallback default* (`DEFAULT_ROLE_REASONING_EFFORT`
  in `types.ts`) for a role nobody's explicitly touched — every one of the five call sites that used to
  read that object directly (`chat/route.ts`, `agent.ts`, `council.ts`, `connections.ts`,
  `archive/ask/route.ts`) now calls `reasoningEffortForRole(role)` instead, so nothing had to change
  about how the value gets *used*, only where it comes from. Only takes effect for OpenRouter-assigned
  models — Anthropic's provider doesn't wire up an equivalent control, and the Settings copy says so.
- **§32–34 Tools & permissions** — real tool layer (`search_archive`, `calculator`, `web_search`,
  `web_fetch`, `run_python`, `run_javascript`), executed by Magi never the model. **§33 web access**:
  `web_search`/`web_fetch` (`src/lib/tools/webSearch.ts`) call Tavily's `/search` and `/extract` APIs
  directly, gated by a Tavily key in Settings → Providers. When no Tavily key is configured,
  OpenRouter-routed requests transparently fall back to OpenRouter's own built-in web plugin
  (`plugins: [{ id: "web" }]`, added in `requestExtras()` in `openrouter.ts`, which also strips the two
  tools from what's offered so the model doesn't call a tool that would just error) — Anthropic-direct
  calls have no such fallback and the tools simply return a "not configured" error until a Tavily key is
  set. **§33 code execution**: `run_python`/`run_javascript` (`src/lib/tools/codeExec.ts`, spawning
  `workers/codeExecWorker.mjs`) run in genuinely sandboxed WASM engines — Pyodide (CPython-in-WASM) for
  Python, QuickJS-WASM for JavaScript — each in a fresh `node:worker_threads` Worker with a 15s hard
  timeout (`worker.terminate()`, confirmed live to kill a synchronous infinite loop) and a
  `resourceLimits` memory ceiling. Neither engine is given any host binding (no `require`, no `fetch`,
  no real filesystem — confirmed live inside the QuickJS context that `typeof process/require/fetch` are
  all `"undefined"`), so isolation holds by construction rather than by policy. One exception, narrow and
  deliberate: Python `import` statements trigger `loadPackagesFromImports()`, which fetches Pyodide's own
  pre-built wheels (numpy, pandas, …) over the network *from Magi's server process*, before execution —
  the executed code itself never gets network access. **Real bundler gotcha hit and fixed**:
  `loadPyodide()`'s default asset-path auto-detection breaks under this dev server (resolves to
  `node_modules/src/js/pyodide.asm.mjs` instead of `node_modules/pyodide/...`) — fixed by passing
  `indexURL` explicitly, computed via `path.dirname(fileURLToPath(await
  import.meta.resolve("pyodide")))` from inside the worker file. The worker file itself is deliberately
  plain `.mjs` outside `src/`, loaded by a filesystem path rather than through Next's bundler, for the
  same reason `pdf-parse` needed `serverExternalPackages` — see the Documents & Artifacts entry below.
  **§34 granular permissions**: one chokepoint, `resolveTools()` in
  `src/lib/tools/registry.ts`, that every caller (conversations, Agents, Councils, Connections) now goes
  through instead of the raw tool list. A global per-tool on/off toggle in Settings applies everywhere;
  Skills get a per-entity allowlist (set at creation, since Skills have no edit flow yet) that can only
  narrow past the global list, never widen it; Agent runs get the same, chosen per-launch since Agents
  have no persistent template to attach permissions to. `executeTool()` also enforces the resolved
  allowlist itself, not just by omission from what the model is offered, in case a model requests a tool
  it wasn't given. **The "ask before doing X" confirmation flow from §34 (and the Vision's own `Run Code
  → Ask` example) was deliberately not built for code execution either** — a real pre-execution approval
  gate means pausing an in-flight streaming tool-call loop across HTTP request boundaries (persisted
  mid-turn state, a resume endpoint, an approval UI), which nothing in the codebase does today for any
  tool. Given the sandbox already has no filesystem, no network, no OS process access, a hard timeout,
  and a memory ceiling, the blast radius is small by construction; a synchronous approval gate would cost
  a large amount of new architecture for what it adds on top of that. On/off in Settings only, for now.
- **§35–37 Skills** — persistent, global or Project-scoped, three starters offered.
- **§38–39 Agents** — full pipeline, fire-and-forget background execution, live polling, stoppable
  between steps.
- **§40–45 Councils** — persistent Council configs with custom roles; disagreement explicitly preserved
  and shown. **§42 now has three selectable modes**, not one fixed pipeline: Independent Analysis
  (analysis → critique → synthesis, the original flow, extracted verbatim into
  `runIndependentAnalysis()`), **Debate** (`runDebate()`: opening → one rebuttal round → synthesis,
  exactly 2 roles — pairwise only, since N-way debate is real separate complexity the vision text
  doesn't imply), and **Red Team** (`runRedTeam()`: proposal → attack → defense → synthesis, 1 proposer
  + 1-or-more attackers). Mode is a per-run choice in `src/app/councils/CouncilsClient.tsx`, not baked
  into a saved Council — the same role list (default or saved) can run through any mode. Role-count
  requirements are validated in `POST /api/councils/run` with a clear 400, echoed client-side so the
  "Deliberate" button disables before the request even goes out. All three modes share the same
  `completeAs()` call helper in `src/lib/council.ts` (model resolution, tool resolution, reasoning
  effort, usage recording) and the same synthesis structure (`Consensus` / `Key disagreement` /
  `Synthesis`) — **neither Debate nor Red Team's synthesizer ever declares a winner**, per Product
  Vision §44; Debate characterizes *why* the two sides disagree (factual vs. values-based vs.
  missing-information) and Red Team assesses which attacks actually landed against the defense, not
  "attacker wins" / "proposer wins." Verified live end-to-end for both new modes, including confirming
  the defense stage's prompt actually contains the attack content (real engagement, not a re-answer).
- **§46–48 Documents & Artifacts** — Project documents now accept real file upload (PDF/DOCX/TXT/MD/
  CSV/JSON), not just pasted text: `POST /api/documents/upload` extracts text server-side via
  `src/lib/files/extractText.ts` (`pdf-parse`'s `PDFParse` class, `mammoth.extractRawText` for DOCX) and
  stores the original file under `data/documents/`, mirroring the binary-on-disk pattern already used
  for generated images (`src/lib/repo/images.ts`). Images are rejected here with a message pointing at
  conversation attachments instead — Project Documents inject into `contextBuilder.ts`'s single
  text-only system prompt, so an image would be inert at that layer. **New: conversation attachments**
  — a message can carry files too (`attachments` table, `POST /api/conversations/[id]/attachments`),
  wired into `chat/route.ts`: text-kind files (same extractor) get their extracted text baked into that
  message's stored content; image-kind attachments get real multimodal content only for the live turn
  they're attached to (`ModelMessage.content` is now `string | ContentPart[]`, mapped to each provider's
  native image-block shape in `anthropic.ts`/`openrouter.ts`), gated by a new `ModelInfo.supportsVision`
  flag (hardcoded true for Anthropic's four models, read from OpenRouter's
  `architecture.input_modalities` for everything else) — a model without vision gets an honest
  `[Image attached: …]` text placeholder instead of a broken request. Verified live: real PDF/DOCX text
  extraction, a vision-capable OpenRouter model correctly describing a test image's color and text, and
  a non-vision model correctly reporting it can't see the image rather than hallucinating. One real
  bundler gotcha hit and fixed: `pdf-parse` (which wraps `pdfjs-dist`) needs
  `serverExternalPackages: ["pdf-parse", "@napi-rs/canvas"]` in `next.config.ts` plus an `import
  "pdf-parse/worker"` before `pdf-parse` itself, or Next's dev/build bundler can't resolve the PDF.js
  worker script and every extraction fails with "Setting up fake worker failed." **New: `create_docx`
  tool** generates real, well-formatted Word documents rather than pasting Markdown in as plain text.
  `src/lib/files/markdownToDocx.ts` parses Markdown with `unified`/`remark-parse`/`remark-gfm` into an
  mdast tree and walks it by hand into genuine `docx` constructs — real heading styles, real list
  numbering (bullet and ordered, including nesting), real tables with a shaded header row, hyperlinks,
  blockquotes, shaded code blocks — deliberately not delegated to a generic HTML-to-docx converter, since
  that would mean losing control over exactly how each construct renders. A considered default style
  (heading colors/sizing, not Word's bare default) is applied via `Document({ styles: ... })`, overriding
  the built-in `Heading1`..`Heading6` style ids. This is also **what finally gave Artifacts a download
  path** — until now there was no artifact viewer or download UI anywhere in Magi (the Project dashboard's
  Artifacts section was a static, non-clickable title + version row). Rather than build a new entity,
  `artifacts` gained the same `mime_type`/`file_path` extension `documents` already got, `POST
  /api/artifacts/[id]/file` mirrors the existing `images/[id]/file` binary-serving route (plus
  `Content-Disposition: attachment` like the project-export route already does), and artifacts with a
  `mime_type` are real download links in the dashboard now; plain-text artifacts are unchanged — a full
  artifact viewer is still out of scope. `content` keeps storing the Markdown *source*, not text pulled
  back out of the generated .docx, so generated documents stay FTS-searchable exactly like before.
  Versioning reuses `createNewVersion()` unchanged — passing `artifact_id` to the tool revises a docx
  lineage instead of creating a new one. Verified live: a real multi-section document (headings, bold/
  italic, bullet and numbered lists, a table, a link) round-tripped through Word formatting correctly,
  not as escaped Markdown text; a revision correctly incremented the version and linked `parent_id`.
  **Generated files now also show up inline in the conversation that made them**, not just the Project
  dashboard: `artifacts` gained a `message_id` column (same nullable-extension pattern again), and
  `attachArtifactsToMessage()` in `artifacts.ts` links a tool-created artifact to the assistant message it
  belongs to — mirroring `attachToMessage()` for conversation attachments, and for the same underlying
  reason: `create_docx` runs mid-stream, before the assistant message it belongs to has been persisted, so
  the artifact is created first (`message_id` null) and linked afterward once `addMessage()` returns a
  real id. The link is `ToolContext.onArtifactCreated` (`registry.ts`), a callback `chat/route.ts` supplies
  to collect ids during the turn's tool loop, then applies via `attachArtifactsToMessage()` right after
  `addMessage()` — in both the normal-completion and partial-content-on-error paths. `GET
  /api/artifacts?conversationId=…` (`listArtifactsByConversation()`, deliberately *not*
  lineage-collapsed like `listArtifacts()` — every turn that produced a file, including revisions, is a
  distinct point in that conversation's own history) feeds `ConversationView.tsx`, which renders a real
  download chip directly under whichever message created each file. Verified live: the artifact's
  `message_id` matched the actual persisted assistant message id, the chip rendered under the right
  message, and the link served the correct file with the right `Content-Type`/`Content-Disposition`.
- **§51–57 Image Studio** — real generation via OpenRouter multimodal models, Style Guides, Characters
  with reference images, variations. **No Brand Libraries (§55)** distinct from Style Guides/Characters.
- **§59–63 Interoperability & portability** — Project export/import (Magi's own JSON format).
  **§63 import from other AI systems**: `POST /api/projects/import` now also accepts a ChatGPT or
  Claude `conversations.json` (from each vendor's own data-export feature) alongside Magi's own format,
  detected structurally (`mapping`+`current_node` → ChatGPT, `chat_messages` → Claude — see
  `src/lib/importers/detect.ts`), not by file extension or a format picker. Each gets its own parser
  (`src/lib/importers/chatgpt.ts`, `claude.ts`) that converts straight into the existing `ExportBundle`
  shape as one new "catch-all" Project, so `importProject()` itself needed no new data path — only two
  new producers of the type it already accepted. ChatGPT's export is a tree (`mapping`) to support
  edits/regenerations; the parser walks **backward** from `current_node` to the root rather than forward
  from the root, since that pointer unambiguously names the active branch — forward traversal would have
  to guess which sibling of an edited message was kept. Verified against a synthetic fixture with a real
  edit (two branches from one parent) to confirm the stale branch is correctly discarded, not the live
  one. Deliberately out of scope: no ZIP handling (user extracts and points at `conversations.json`
  directly — consistent with this codebase's pattern of avoiding new dependencies elsewhere, e.g.
  embeddings uses brute-force JS over a real vector index), no images/attachments (text only, matching
  Magi's `Message` schema), no ChatGPT tool/plugin/browsing turns (only user/assistant text — tool nodes
  are skipped, not garbled into a message). **A real bug was caught and fixed while building this**: see
  "Lessons learned" below — bulk imports were about to fire one background embedding request per message.
- **§74 The Magi Mark** — `src/components/MagiMark.tsx`: two verticals plus a diagonal chevron on a
  24×24 grid, with deliberate gaps at both shoulders so the three strokes read as distinct before
  resolving into an M. Uses `currentColor` (no hardcoded hex), shared by the sidebar, the mobile top
  bar, and `src/app/icon.svg` (favicon/app icon).
- **§67–76 Visual design** — the aesthetic system is real and consistently applied: light/dark themes,
  typography-led, no gradients/glassmorphism, restrained motion. **No formal accessibility audit (§76)**
  — focus states and `prefers-reduced-motion` are respected, but nothing beyond that has been verified.
  **No dedicated mobile UI (§75)** — responsive layout with a drawer nav, not a from-scratch mobile
  experience.

---

## What's not built (real gaps, not just "future work")

Roughly in order of how much they'd matter to a real user:

1. **Brand Libraries (§55)** — distinct from Style Guides/Characters in the vision; not built.
2. **No automated tests.** Every feature in this codebase has been verified by manually driving the
   browser and hitting API routes directly during development sessions. There is real risk of silent
   regressions. See "How this was actually tested" below for the closest thing to a test plan that
   exists, and consider it a starting point for real tests.
3. **Single-user, no auth.** Deliberate for now (personal, local-first), but worth being explicit: if
   remote/multi-device access is ever wanted, auth needs to be designed in, and the fire-and-forget
   background-job pattern (below) doesn't survive a move to serverless hosting as-is.
4. **Mobile UI (§75) and accessibility audit (§76)** are both "not actively broken" but not built out
   to the standard the vision describes.
5. **No per-tool permissions for Councils** — every mode's "first look" stages (analysis / opening /
   proposal+attack) get `search_archive`/`calculator`, later stages don't, but this is a fixed pattern
   across all three modes, not something configurable per role like Skills and Agent runs now have.
   Left out deliberately since the vision names Skills and Agents specifically, but worth a look if
   Councils grow more tool-using stages.
6. **No edit flow for Skills** — only create/delete. A Skill's tool allowlist (like everything else
   about it) can only be set at creation time; changing it means delete and recreate.
7. **Imported ChatGPT/Claude conversations land in one undifferentiated Project**, not auto-sorted by
   topic — Magi has no conversation-move-between-Projects feature yet to make a smarter split useful,
   and real auto-categorization is separate judgment-call work, not a side effect of import parsing.
8. **No ZIP upload for foreign imports** — the user must extract the vendor's `.zip` and select
   `conversations.json` directly. Deliberate (no new dependency), but worth reconsidering if it turns
   out to be a real friction point.
9. **Debate mode is pairwise only** — exactly 2 roles, no N-way debates or round-robin pairings. Not
   implied by the Product Vision text, and real, separate complexity if ever wanted.

---

## Architecture decisions worth understanding before changing anything

**Fire-and-forget background jobs (Agents, Connections).** The API route creates a DB row with
`status: 'running'`, kicks off an async function *without awaiting it*, and returns immediately. The
client polls a GET endpoint every ~2s. This only works because Magi runs as a long-lived local Node
process (`next dev` / `next start`), not a serverless function that gets frozen after the response is
sent. **If Magi is ever deployed to a serverless platform, this pattern breaks silently** — the
background work would be killed mid-run. Would need a real job queue at that point.

**Model provider abstraction (`src/lib/models/`).** Everything else in the app asks for a *role*
(`modelForRole("reasoner")`), never a model id directly. `registry.ts` resolves role → model, with a
fallback that picks a sensible default from whichever provider is actually configured if the user
hasn't explicitly assigned a role yet. Adding a third provider means: write an adapter implementing
`ModelProvider`, register it in `PROVIDERS` in `registry.ts`. Nothing else should need to change.

**Capability-aware requests (added this session).** OpenRouter's `/models` response includes
`supported_parameters`, a `reasoning` object (`mandatory`, `default_effort`, `supported_efforts`), and
`top_provider.max_completion_tokens` *per model*. This is fetched and cached (`refreshOpenRouterModels`
in `openrouter.ts`) alongside the model list, and used to shape every request: tools are only sent to
models that support them, reasoning effort is set explicitly rather than left to the model's own
(sometimes very expensive) default, and `max_tokens` is clamped to what the model can actually return.
**This is the actual answer to "does new code need to be written when OpenRouter adds new models?"** —
see the next section.

**Tool layer (`src/lib/tools/`).** Tools are plain data (`TOOL_SPECS`) plus an `executeTool()` dispatch
function. The model never executes anything — it requests a tool by name, the provider's `complete()`/
`stream()` loop calls `executeTool()`, and the result is fed back. Both providers implement the same
tool-loop shape (`MAX_TOOL_ITERATIONS = 10`) independently, since Anthropic's and OpenAI-compatible
tool-calling wire formats are genuinely different — there's some duplication between `anthropic.ts` and
`openrouter.ts` here that a future pass could factor out if a third tool-calling-shaped provider shows up.

---

## Does code need to change when OpenRouter adds new models?

**For an ordinary new text model: no.** The catalog is fetched live; a new model just appears in every
dropdown and role-assignment list the next time someone refreshes. The capability system added this
session means Magi also automatically adapts *how* it talks to that model (tool support, reasoning
effort, token ceiling) without anyone touching code, because those adaptations already read from the
same live metadata rather than a hardcoded per-model table.

**What could still require a code change:**
- A genuinely new *shape* of behavior OpenRouter hasn't exposed metadata for yet — e.g. if some future
  model needs a request parameter Magi doesn't know to send, or returns content in a field neither
  `content` nor `reasoning`/`reasoning_content` (the two fallback fields `extractText()` checks in
  `openrouter.ts`).
- A new *modality* (Magi currently handles text and image-in-chat-completions; audio or video models
  would need new plumbing, same as image generation needed its own `modalities`/`image_url` handling
  this session).
- OpenRouter changing the *shape* of `/models` itself (unlikely but not impossible) — everything reading
  it (`refreshOpenRouterModels`) would need updating in one place.

In short: **new models, no code change. New *kinds* of models or new API shapes, yes.** This is about as
model-agnostic as a text-first architecture reasonably gets without OpenRouter itself changing its
contract.

---

## Lessons learned this session (read before repeating this work)

1. **The empty-content/plan-narrating bug wasn't a token-budget problem — it was a reasoning-effort
   problem.** Some models (GLM-5.3-Flash, ~21% of the catalog have *mandatory* reasoning) spend their
   entire turn thinking before producing visible `content`, sometimes at *maximum* effort by default.
   Bigger `max_tokens` and prompts forbidding narration were band-aids that helped but didn't fix it.
   The actual fix was discovering and using OpenRouter's `reasoning: { effort }` request parameter,
   gated by each model's advertised `supported_efforts`. If something like this recurs with a provider
   that doesn't expose this metadata, the band-aids (generous token budget + explicit "don't narrate,
   answer directly" system prompt + a text/reasoning-field fallback) are still worth keeping as a safety
   net — they're in `extractText()` and the `AGENT_BOUNDARIES` prompt in `agent.ts`.
2. **A real, sneaky Next.js bug**: a client component calling `useSearchParams()` inside a `<Suspense>`
   boundary rendered correctly server-side but never hydrated on a **fresh/hard load of a URL that
   already carried the query param** — content sat in the DOM behind a stuck streaming-SSR reveal
   boundary (a `<div hidden id="S:0">`), with **zero console errors**. Client-side navigation to the
   identical state worked fine, which is what made it hard to catch — it looked like it worked because
   testing tends to start from a client-side click, not a hard reload. Fixed in `ImageLabClient.tsx` by
   reading the query param from `window.location.search` in a `useEffect` instead of the hook, removing
   the need for Suspense on that route. **If a client component with `useSearchParams()` + Suspense ever
   seems to work in dev but a user reports a blank page on a direct link, check this first.**
3. **TypeScript target matters for regex flags** — the `/s` (dotAll) flag needs ES2018+; this project's
   `tsconfig.json` target doesn't have it. Use `[\s\S]` instead of `.` with `/s` when you need
   newline-inclusive matching. Caught at build time (`error TS1501`), not runtime — easy to miss if you
   only run `next dev` and never `next build` before committing.
4. **PowerShell mangles commit messages passed inline via `-m` if they contain quotes or parentheses**
   (native-executable argument parsing issue, not a git issue). Every commit this session used
   `git commit -F <path-to-a-temp-file>` instead. Keep doing this.
5. **The browser automation tooling in this environment has real, recurring flakiness**: the screenshot
   action times out unpredictably, and `read_page` has returned stale/cached trees at least twice this
   session (showing content from a *previous* page state, not the current DOM). When something looks
   wrong, cross-check with `get_page_text`, direct `javascript_tool` execution
   (`document.body.innerText`, `document.querySelectorAll(...)`), and the network-request log before
   concluding the *app* is broken — it might just be the tool. That said, don't dismiss every anomaly as
   tooling: the Suspense bug above was real and was only caught by not giving up on the discrepancy.
6. **After any change to what capability data is fetched/cached, hit `POST /api/models/refresh`** (or
   re-save the OpenRouter key) before testing — the cache doesn't retroactively backfill new fields.
7. **`better-sqlite3` is a native module.** It built fine here via a prebuilt binary for Node 22 on
   Windows; if it ever needs a rebuild (Node version change, different OS/arch), expect a node-gyp step.
8. **OpenRouter's `/models` catalog does not list embedding models**, unlike chat and image models —
   confirmed by direct testing: none of ~400 catalog entries advertise an `embeddings` output modality,
   even though `POST /v1/embeddings` itself works fine when called with a known-good model id (verified
   live: `openai/text-embedding-3-small`, `openai/text-embedding-3-large`, `google/gemini-embedding-001`,
   `qwen/qwen3-embedding-8b` all return real vectors; guessed ids like `cohere/embed-v4.0` and
   `mistralai/mistral-embed` 400'd as not existing — don't assume a plausible-looking id works without
   testing it). Don't trust marketing/docs pages implying catalog-based discovery works the same way it
   does for image models — verify against the live `/models` response before building a feature around
   it. `OPENROUTER_EMBEDDING_MODELS` in `openrouter.ts` is therefore a short hardcoded list, not a live
   fetch, and needs a human to add an entry (and verify it against the real endpoint) if OpenRouter adds
   a genuinely new embedding model worth offering.
9. **Lesson #1's bug class recurred, on a different model, with a much smaller budget** — the new
   `classifyModelRole()` in `registry.ts` (automatic model selection, §29) first shipped with
   `maxTokens: 10` since the expected reply is one short word. It silently misclassified *everything* as
   `"default"`. Direct testing showed why: the assigned "fast" model at the time (`qwen/qwen3.8-flash`)
   has mandatory reasoning it can't be told to skip, and spent the entire 10-token budget on hidden
   reasoning without ever reaching the answer. Fixed by raising the budget to 300 (still a fraction of a
   cent) and matching role ids by substring instead of exact string equality. **The general lesson: never
   assume a "tiny expected output" task can get a tiny token budget** — mandatory-reasoning models pay
   the reasoning tax regardless of how short the final answer will be, and a starved budget produces a
   confident-looking wrong answer (silent fallback), not an obvious error. Verify any new small/cheap
   model call against a real reasoning-mandatory model before trusting a low `maxTokens` guess.
10. **A per-row background side effect that's fine for interactive use can be a bulk-write disaster** —
    caught while building foreign-import support, not after shipping it. `indexUpsert()`
    (`src/lib/searchIndex.ts`) fires a fire-and-forget embedding request per call, which is exactly the
    right design for one message at a time as a user actually converses. Nobody had reasoned about what
    it does inside a loop: `importProject()` (`src/lib/portability.ts`) calls it once per message, and a
    real ChatGPT export can be tens of thousands of messages — that would have been tens of thousands of
    concurrent, unthrottled requests fired at OpenRouter in one HTTP request, with no queue, no backoff,
    no user-visible progress. Fixed with a `skipEmbedding` opt-out on the bulk path, pointing at the
    existing "Build index" backfill (already batched/rate-limited) to index afterward instead. **The
    general lesson: before adding a background side effect to a function that's already called from a
    loop somewhere else in the codebase, grep for its other call sites and check whether any of them are
    bulk paths** — a fire-and-forget hook is a latent multiplier, not just a per-call cost, and it's easy
    to add it while only thinking about the interactive call site you're looking at.

---

## How this was actually tested (there's no test suite — this is the closest thing)

Every feature in this codebase was verified by, roughly, this loop:
1. `npm run build` (typecheck + compile) and `npm run lint` — both must be clean (0 errors; the
   `react-hooks/set-state-in-effect` rule is intentionally downgraded to a warning in
   `eslint.config.mjs` because it flags standard fetch-on-mount/reset-on-navigation patterns used
   throughout — see the comment there before re-tightening it).
2. Start the dev server, then either drive the actual browser UI, or — often faster and more reliable
   for backend logic — call the API routes directly with PowerShell (`Invoke-RestMethod`) and inspect
   the JSON/DB state directly.
3. For anything involving a live model call, this was done against the user's real Anthropic and
   OpenRouter API keys — there is no mock provider. Expect real cost when re-verifying model-dependent
   behavior.
4. For long-running things (Agents, Council, Connections), poll rather than block; a `ScheduleWakeup`-
   style check-back pattern was used repeatedly rather than sitting idle waiting on a slow model.

If you add a real test suite, Playwright (browser) + direct API-route tests (Vitest/Jest hitting the
route handlers or repo functions against a temp SQLite file) would map naturally onto how this was
already being verified by hand.

---

## Practical notes for continuing this

- `data/` is gitignored — the user's real database and generated images live there. Never assume it's
  safe to wipe; check what's in it before any "reset to clean state" action, and ask if unsure.
- The `docs/` folder (`Product Vision.txt`, `User Guide.md`, this file) is the canonical context. Keep
  `User Guide.md` in sync with user-facing changes and this file in sync with architectural ones — both
  drift fast otherwise.
- Settings → "About this build" (`SettingsClient.tsx`) is a short in-app summary of what's built; keep
  it honest and current, it's the fastest way for the user to sanity-check what changed.
- When in doubt about scope for a new piece of the vision, the vision itself says it plainly: build a
  small, real, working subset; let the architecture anticipate the rest; don't build a facade.
