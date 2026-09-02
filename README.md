# Magi

**A personal instrument for thinking.**

> The models will change. Your environment should not have to.

Magi is a persistent, personal AI environment — the durable layer that sits above whichever model
you happen to be using. Projects, memory, and archive live here; models are replaceable instruments
passing through. See [`docs/Product Vision.txt`](docs/Product%20Vision.txt) for the full vision this
build is working toward, [`docs/User Guide.md`](docs/User%20Guide.md) for how to actually use it, and
[`docs/Handoff.md`](docs/Handoff.md) if you're picking up development on this codebase.
[`docs/People-Plan.md`](docs/People-Plan.md) is the brief for the next feature, not yet built.

This repository is a working subset of that vision: Projects with persistent instructions, streaming
conversations with tool use, deliberate memory (global and per-Project), full-text archive search, an
"Ask my archive" mode, reusable Skills, the Magi Council for multi-role deliberation, Agents that
pursue a multi-step objective and can be watched and stopped mid-run, an Image Lab with Style Guides
and Characters for visual continuity across generations, cross-Project connection discovery, and
Project export/import. The model layer has two providers — Anthropic directly, and OpenRouter (which
in turn proxies most of the industry, image-generation models included) — wired through an
abstraction built to add more without touching the rest of the app.

## Running it

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). On first run, go to **Settings** and add an
API key for at least one provider — Magi needs one before it can think. Anthropic is a direct
integration; OpenRouter is a one-stop shop for most other providers' models, with its catalog fetched
live from OpenRouter's own API rather than hardcoded. Keys are stored locally in Magi's own SQLite
database (`data/magi.db`, gitignored) and used only to call that provider's API directly from your
local server.

Magi calls whichever models you assign to its roles, and those calls cost money on your own account.
Settings → **Usage & cost** shows what has been spent, per model and per day.

## Run it on your own machine only

**Magi has no authentication, and it is not meant to be deployed.** It is a single-user instrument:
the SQLite file next to it holds your API keys, your entire archive, and everything you have ever
told it. On `localhost` that is exactly right. On a public host it means anyone who finds the URL can
read your archive and spend your money.

Because it is a Next.js app and deploying those is a reflex, Magi refuses any request that did not
arrive on a loopback address (`src/middleware.ts`). If you genuinely want to run it on a home server
behind your own authentication, set `MAGI_ALLOW_REMOTE=1` — but that is a deliberate decision to make
yourself, not a default.

## Tests

```bash
npm test
```

Vitest, against a throwaway SQLite database per test file and a mock model provider — no network, no
API key, a few seconds to run. It covers the repo layer, retrieval, and the pipelines end to end
(conversation windowing, episode closing, Agents including Skill-driven ones, and Councils). Many of
the tests are labelled regressions for specific bugs, which is the point: this codebase is edited
quickly, and silent regression is the likeliest way it gets hurt.

## How it's built

- **Next.js (App Router) + TypeScript** — server components for read paths, API routes for
  mutations and the streaming chat endpoint.
- **SQLite** (`better-sqlite3`), local-first — this is the user's own environment; nothing is sent
  anywhere except to whichever model provider a conversation actually calls.
- **Model provider abstraction** (`src/lib/models/`) — Skills, Councils, Agents, and conversations
  request a *role* ("the reasoner," "the critic"), never a hardcoded model. Reassigning a role in
  Settings upgrades every caller at once, regardless of which provider it comes from. Adding a
  provider means writing one adapter and registering it.
- **Full-text search** (SQLite FTS5) over Projects, conversations, memory, documents, artifacts, and
  Skills, plus an "Ask my archive" mode that hands matching material to a model to synthesize.
- **Projects as places** (`src/components/ProjectStanding.tsx`) — a Project opens on where the work
  stands: open questions, decisions, and what has happened lately, above its contents rather than
  among them. Fed by closing conversations, and editable by hand.
- **Conversation lifecycle** (`src/lib/conversationWindow.ts`, `src/lib/episodeClose.ts`) — long
  conversations send a recent verbatim window plus a rolling summary of older turns rather than the whole
  history every time. Closing one drafts a summary, the decisions it settled, the questions it left open,
  and proposed memory — all of it inert until kept by hand, which is what the `suggested` memory status
  is for.
- **Trajectory** (`src/lib/trajectory.ts`) — because every passage is dated, the archive can answer
  when a topic first appeared, how often it came up since, and what was being said at each point.
  The timeline is pure retrieval and costs nothing; having a model characterize the change is a
  separate, opt-in step.
- **Retrieval-first context assembly** (`src/lib/retrieval.ts`) — everything in a Project is also
  indexed as ~1200-character passages. Each turn retrieves the passages that bear on the message
  actually being asked, fusing embedding similarity with keyword bm25, rather than injecting whichever
  documents happen to come first until a character budget runs out. The Context panel shows exactly
  which passages were used, where each came from, and when it was written.
- **Tool layer** (`src/lib/tools/`) — the model requests a tool (`search_archive`, `calculator`);
  Magi's tool layer is what actually executes it, never the model itself. Cross-Project search is a
  user-controlled permission, not an assumption.
- **Agents** (`src/lib/agent.ts`) — given an objective, an Agent plans, researches (with tools),
  drafts, critiques itself, revises, and saves the result as a Project artifact. Runs as a
  fire-and-forget background job on Magi's own server, polled by the client, stoppable mid-run.
- **A composing hierarchy** (`src/lib/skillComposition.ts`) — a Skill is a method: instructions, the
  model role it wants, its tool allowlist, and optionally a staged pipeline. Agents run a Skill's
  stages in place of their built-in ones; Council members can work by a Skill. A Skill supplies
  defaults and can only ever narrow permissions — it never overrides a choice the user made.
- **Image Lab** (`src/app/image-lab/`, `src/lib/repo/images.ts`) — generation and editing through
  OpenRouter's multimodal chat-completions models (Gemini "Nano Banana," GPT-5 Image, and whichever
  others advertise image output — discovered live, not hardcoded). Style Guides and Characters are
  Project-scoped and can be threaded into a generation as reference images, so a character or visual
  language stays consistent across a body of work rather than resetting every prompt. Files live on
  disk under `data/images/`; only metadata sits in SQLite.
- **Connections** (`src/lib/connections.ts`) — from a Project, investigate one specific other Project
  or all of them for what's genuinely relevant. Uses `search_archive` scoped to the target Project so
  the model checks rather than guesses, and is explicitly instructed to report "nothing substantive"
  rather than manufacture a connection. A finding can be promoted into the source Project's memory,
  with its origin recorded. The Projects never merge — only the connection becomes visible.

## About this repository

Magi is a personal instrument. I built it for my own work and use it daily; it is published because
the ideas in [`docs/Product Vision.txt`](docs/Product%20Vision.txt) seem worth sharing and because
some of it may be useful to other people building in this space.

It is not a product and there is no support. Issues and pull requests are welcome and I'll read them,
but I make no promises about response times, backwards compatibility, or a roadmap. If you want to
take it somewhere I'm not going, fork it — that's what the licence is for.

Two things worth knowing before you run it: the security note above is not boilerplate, and Magi's
schema evolves in place, so expect the database to be migrated under you between commits.

## Licence

[MIT](LICENSE).
