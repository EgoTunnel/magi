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
                                characters. Thin wrappers over better-sqlite3 + search index upkeep.
    tools/
      registry.ts               TOOL_SPECS + executeTool() — the actual tool layer
      calculator.ts             Hand-written arithmetic parser (deliberately not eval())
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
  with citations). **Keyword search, not semantic/embedding search** — see gaps below.
- **§25–26 Cross-Project intelligence** — `search_archive` tool with a `scope: this_project | all` param
  gated by a Settings toggle (§25), and the standalone Connections feature for proactive discovery (§26).
- **§27–31 Model independence** — provider abstraction (`ModelProvider` interface), two providers live,
  role-based assignment, capability-aware requests. **No cost visibility (§31) at all** — see gaps.
- **§32–34 Tools & permissions** — real tool layer (`search_archive`, `calculator`), executed by Magi
  never the model. **Permissions are just the one cross-Project toggle** — no granular per-Skill/
  per-Agent permission system (§34).
- **§35–37 Skills** — persistent, global or Project-scoped, three starters offered.
- **§38–39 Agents** — full pipeline, fire-and-forget background execution, live polling, stoppable
  between steps.
- **§40–45 Councils** — Independent Analysis / Critique / Synthesis modes implemented as one fixed
  pipeline; persistent Council configs with custom roles; disagreement explicitly preserved and shown.
  **Debate and Red Team modes from §42 are not separately implemented** — only the Independent
  Analysis→Critique→Synthesis flow exists.
- **§46–48 Documents & Artifacts** — Project documents (plain text), artifacts with version chains
  (`parent_id` linking).
- **§51–57 Image Studio** — real generation via OpenRouter multimodal models, Style Guides, Characters
  with reference images, variations. **No Brand Libraries (§55)** distinct from Style Guides/Characters.
- **§59–63 Interoperability & portability** — Project export/import (Magi's own JSON format only —
  **no import from other AI products' export formats**, §63).
- **§74 The Magi Mark** — a simple three-converging-lines glyph, used as the sidebar logo and favicon.
- **§67–76 Visual design** — the aesthetic system is real and consistently applied: light/dark themes,
  typography-led, no gradients/glassmorphism, restrained motion. **No formal accessibility audit (§76)**
  — focus states and `prefers-reduced-motion` are respected, but nothing beyond that has been verified.
  **No dedicated mobile UI (§75)** — responsive layout with a drawer nav, not a from-scratch mobile
  experience.

---

## What's not built (real gaps, not just "future work")

Roughly in order of how much they'd matter to a real user:

1. **Cost visibility (§31)** — no token/spend tracking anywhere. With OpenRouter proxying dozens of
   paid models, a user could rack up real cost with no visibility inside the app. Worth prioritizing.
2. **Semantic/embedding search (§23)** — Archive search is FTS5 keyword matching. "Search by meaning"
   as the vision describes would need an embeddings pipeline (a vector column, an embedding model call
   on write, cosine-similarity search on read). Not started.
3. **Granular permissions (§34)** — only the cross-Project search toggle exists. No per-Skill,
   per-Agent, or per-tool permission system; no "ask before doing X" confirmation flow for anything.
4. **Automatic/intelligent model selection (§29)** — the user always picks. No logic recommends a model
   based on task type.
5. **Reasoning effort is not user-configurable** — `ROLE_REASONING_EFFORT` in `src/lib/models/types.ts`
   is a hardcoded map (reasoner/synthesizer → high, researcher → medium, else → low). Given the
   capability system now in place, exposing this as a per-role Settings control would be a natural,
   fairly small next step.
6. **Import from other AI systems (§63)** — export/import only round-trips Magi's own format. No
   ChatGPT/Claude-export ingestion.
7. **Brand Libraries (§55)** — distinct from Style Guides/Characters in the vision; not built.
8. **Debate / Red Team Council modes (§42)** — only Independent Analysis→Critique→Synthesis exists.
9. **No automated tests.** Every feature in this codebase has been verified by manually driving the
   browser and hitting API routes directly during development sessions. There is real risk of silent
   regressions. See "How this was actually tested" below for the closest thing to a test plan that
   exists, and consider it a starting point for real tests.
10. **Single-user, no auth.** Deliberate for now (personal, local-first), but worth being explicit: if
    remote/multi-device access is ever wanted, auth needs to be designed in, and the fire-and-forget
    background-job pattern (below) doesn't survive a move to serverless hosting as-is.
11. **Mobile UI (§75) and accessibility audit (§76)** are both "not actively broken" but not built out
    to the standard the vision describes.

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
