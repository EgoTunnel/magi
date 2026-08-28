# Magi

**A personal instrument for thinking.**

> The models will change. Your environment should not have to.

Magi is a persistent, personal AI environment — the durable layer that sits above whichever model
you happen to be using. Projects, memory, and archive live here; models are replaceable instruments
passing through. See [`docs/Product Vision.txt`](docs/Product%20Vision.txt) for the full vision this
build is working toward.

This repository is an early, working subset of that vision: Projects with persistent instructions,
streaming conversations, deliberate memory (global and per-Project), full-text archive search, an
"Ask my archive" mode, reusable Skills, and the Magi Council for multi-role deliberation. The model
layer currently has one provider (Anthropic), wired through an abstraction built to add others
without touching the rest of the app.

## Running it

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). On first run, go to **Settings** and add an
Anthropic API key — Magi needs one before it can think. The key is stored locally in Magi's own
SQLite database (`data/magi.db`, gitignored) and used only to call Anthropic's API directly from
your local server.

## How it's built

- **Next.js (App Router) + TypeScript** — server components for read paths, API routes for
  mutations and the streaming chat endpoint.
- **SQLite** (`better-sqlite3`), local-first — this is the user's own environment; nothing is sent
  anywhere except to whichever model provider a conversation actually calls.
- **Model provider abstraction** (`src/lib/models/`) — Skills, Councils, and conversations request a
  *role* ("the reasoner," "the critic"), never a hardcoded model. Reassigning a role in Settings
  upgrades every caller at once. Adding a provider means writing one adapter and registering it.
- **Full-text search** (SQLite FTS5) over Projects, conversations, memory, documents, artifacts, and
  Skills, plus an "Ask my archive" mode that hands matching material to a model to synthesize.

## What's not built yet

The Image Studio, Agents, cross-Project connection discovery, and import/export are part of the
vision but not this build — the architecture anticipates them without pretending they exist. See
the Image Lab page in the app for where that stands.
