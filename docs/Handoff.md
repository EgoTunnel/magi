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
    tools/
      registry.ts               TOOL_SPECS + executeTool() — the actual tool layer
      calculator.ts             Hand-written arithmetic parser (deliberately not eval())
      webSearch.ts               Tavily-backed web_search/web_fetch (search + page extraction)
    agent.ts                    Agent pipeline (plan→research→draft→critique→revise→artifact)
    council.ts                  Council pipeline (analysis→critique→synthesis)
    connections.ts              Connection discovery pipeline
    contextBuilder.ts            Builds the system prompt + provenance for a conversation turn
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
  tool calls made).
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
  `search_archive` (the tool models call) and `POST /api/archive/ask` deliberately still use keyword
  FTS only — rewiring model-facing retrieval to semantic search was left as a deliberate follow-up, not
  a side effect of this pass.
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
  `web_fetch`), executed by Magi never the model. **§33 web access**: `web_search`/`web_fetch`
  (`src/lib/tools/webSearch.ts`) call Tavily's `/search` and `/extract` APIs directly, gated by a Tavily
  key in Settings → Providers. When no Tavily key is configured, OpenRouter-routed requests transparently
  fall back to OpenRouter's own built-in web plugin (`plugins: [{ id: "web" }]`, added in `requestExtras()`
  in `openrouter.ts`, which also strips the two tools from what's offered so the model doesn't call a
  tool that would just error) — Anthropic-direct calls have no such fallback and the tools simply return
  a "not configured" error until a Tavily key is set. **§34 granular permissions**: one chokepoint, `resolveTools()` in
  `src/lib/tools/registry.ts`, that every caller (conversations, Agents, Councils, Connections) now goes
  through instead of the raw tool list. A global per-tool on/off toggle in Settings applies everywhere;
  Skills get a per-entity allowlist (set at creation, since Skills have no edit flow yet) that can only
  narrow past the global list, never widen it; Agent runs get the same, chosen per-launch since Agents
  have no persistent template to attach permissions to. `executeTool()` also enforces the resolved
  allowlist itself, not just by omission from what the model is offered, in case a model requests a tool
  it wasn't given. **The "ask before doing X" confirmation flow from §34 was deliberately not built** —
  both current tools are read-only with no side effects, so there is nothing yet for a confirmation
  dialog to actually gate; building one now would be confirming a hypothetical future write-tool, i.e.
  exactly the kind of facade this codebase's own philosophy rejects.
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
  worker script and every extraction fails with "Setting up fake worker failed." Artifacts still have
  version chains (`parent_id` linking).
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
