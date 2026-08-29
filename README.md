# Magi

**A personal instrument for thinking.**

> The models will change. Your environment should not have to.

Magi is a persistent, personal AI environment — the durable layer that sits above whichever model
you happen to be using. Projects, memory, and archive live here; models are replaceable instruments
passing through. See [`docs/Product Vision.txt`](docs/Product%20Vision.txt) for the full vision this
build is working toward, [`docs/User Guide.md`](docs/User%20Guide.md) for how to actually use it, and
[`docs/Handoff.md`](docs/Handoff.md) if you're picking up development on this codebase.

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
- **Tool layer** (`src/lib/tools/`) — the model requests a tool (`search_archive`, `calculator`);
  Magi's tool layer is what actually executes it, never the model itself. Cross-Project search is a
  user-controlled permission, not an assumption.
- **Agents** (`src/lib/agent.ts`) — given an objective, an Agent plans, researches (with tools),
  drafts, critiques itself, revises, and saves the result as a Project artifact. Runs as a
  fire-and-forget background job on Magi's own server, polled by the client, stoppable mid-run.
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
