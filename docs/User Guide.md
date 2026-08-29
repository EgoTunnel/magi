# Magi — User's Guide

**v1 — for the working subset built so far**

This is the practical companion to [`Product Vision.txt`](Product%20Vision.txt). The vision describes
what Magi is for; this describes what it currently does, and how to use it.

---

## Before you start

Magi runs on your own machine. Nothing about it depends on a remote service except the model
provider you choose to call.

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. The first thing you'll want is a model. Go to **Settings** and add an
API key for at least one provider:

- **Anthropic** — a direct integration. One provider, its own models.
- **OpenRouter** — a single key that reaches most of the industry's models through one API. Its
  model list is fetched live from OpenRouter itself, so it stays current without Magi needing an
  update when they add or retire models.

You can configure both. Nothing else in Magi works until at least one is set.

Everything Magi stores — conversations, memory, documents, images, your API keys — lives in a single
local SQLite file (`data/magi.db`) and a folder of generated images (`data/images/`), both on your own
disk. Nothing is sent anywhere except to the model provider a given action actually calls.

---

## The workspace

The left sidebar is the whole of Magi's top-level structure:

```
Home · Projects · Archive · Memory · Image Lab · Councils · Skills · Settings
```

**⌘K** (or Ctrl+K) opens a command palette that searches across Projects, conversations, memory,
documents, artifacts, Skills, Style Guides, and Characters — by wording, not just by title. The status
bar at the bottom always shows where you are and which model is about to answer.

---

## Projects

A Project is a place, not a folder. Create one from the **Projects** page. Give it:

- **Tagline** — one line, cosmetic.
- **Purpose** — what it's for.
- **Instructions** — role, tone, constraints, terminology. This is injected into every conversation in
  the Project and overrides Magi's general disposition where the two conflict.

Everything else accumulates inside a Project over time:

| Section | What it holds |
|---|---|
| Conversations | Ordinary chat, but editorial rather than bubble-style |
| Agents | Longer-running objectives Magi pursues on its own |
| Connections | On-demand investigation of what relates to other Projects |
| Documents | Reference text always available to conversations in this Project |
| Artifacts | Saved outputs — reports, drafts — with version history |
| Project memory | Established facts specific to this Project |
| Skills available here | Global Skills plus any Project-specific ones |
| Image Lab | A link into that Project's images, Style Guides, and Characters |

**Export** (top of the Project page) downloads everything above as one JSON file. **Import Project**
(on the Projects list page) reads that file back as a brand-new Project — useful for backing work up,
moving it to another Magi install, or just keeping an archive outside the app.

---

## Conversations

Open one from inside a Project. Two dropdowns sit above the message box:

- **Skill** — optionally invoke a reusable method for this turn (see below).
- **Model role** — which role should answer: Default, Reasoner, Writer, Critic, Researcher,
  Synthesizer, or Fast. Roles map to models in Settings, not the other way around.

Type and send. Responses stream in. The model can search your archive or do arithmetic mid-answer —
click **Context** in the top right to see exactly what a given reply drew on: which Project
instructions applied, how much memory and which documents were in play, and which tools it actually
called, with the search terms it used.

Hover an assistant message for three actions:

- **Remember in Project** / **Remember globally** — promotes that message into memory. Nothing
  becomes memory on its own; you decide.
- **Save as artifact** — keeps the message as a standalone, versionable artifact.

---

## Memory

**Memory** in the sidebar shows everything Magi has been deliberately told to retain, split into
**Global** (applies everywhere) and **Project** (applies to one Project). Add, edit, or delete freely.
Nothing here appeared by accident — it was promoted from a conversation, a Council finding, or typed in
directly.

---

## Archive

Two modes, toggled at the top of the **Archive** page:

- **Search** — full-text search by wording across everything Magi holds.
- **Ask** — ask a question in plain language; Magi searches the archive and synthesizes an answer,
  citing which sources it used. If nothing relevant exists, it says so rather than guessing.

---

## Skills

A Skill is a reusable *method*, not just a tool — a named, saved set of instructions for how to
approach a class of task (e.g. "Research," "Literature Review"). Create one from the **Skills** page,
scoped either globally or to one Project. Three starters are offered when you have none yet: Research,
Writing, and Historical Research. Invoke a Skill from any conversation in its scope via the Skill
dropdown.

---

## Magi Council

From the **Councils** page, put a substantial question to several models at once. The default
"Independent Analysis" preset assembles a Reasoner, a Critic, and a Researcher; each analyzes
independently, then reads and critiques the others' analyses, then a Synthesizer reconciles everything
into a final answer — explicitly **preserving disagreement** rather than smoothing it over. The result
page shows a Consensus rating (Strong/Moderate/Weak/None), the specific disagreement if there is one,
and the full transcript by stage.

You can also save a named Council configuration (custom roles, custom system prompts, each assigned a
model role) to reuse later, instead of the default preset.

---

## Agents

An Agent is more autonomous than a Skill: give it an objective from a Project's **Agents** section, and
it plans, researches (using the archive and a calculator), drafts, critiques itself, revises, and saves
the result as a Project artifact — all without further input from you. Open the run to watch it work
step by step, live. **Stop** halts it after its current step finishes (not mid-generation).

An Agent can only search the archive and calculate; it cannot send messages, modify files, or take any
action outside the task.

---

## Image Lab

Open from the sidebar, or from a Project's dashboard (which takes you there already scoped to that
Project). Everything here — Style Guides, Characters, and generated images — belongs to one Project.

- **Generate** — write a prompt, pick a model (only image-capable models are listed), optionally pick
  a Style Guide and one or more Characters, and generate.
- **Style Guides** — a saved visual language (medium, palette, lighting, mood, whatever you write) that
  gets folded into the prompt whenever selected.
- **Characters** — a name and description, optionally with a reference image. Selecting a Character
  during generation sends its reference image along, so its appearance carries across a body of work
  rather than resetting every prompt.
- **Create variation** — from any image in the gallery, start a new generation using that image as a
  reference.
- **Set as Character reference** — assign any generated image as a Character's reference image.

Image generation goes through OpenRouter (Gemini "Nano Banana," GPT-5 Image, and whichever other
models advertise image output — the list is fetched live, same as everything else in Settings).
Anthropic does not do image generation, so an OpenRouter key is required for this page specifically.

---

## Connections

From a Project's **Connections** section, ask what in *another* Project might be relevant to this one
— either one specific Project or all of them at once. Magi investigates the target honestly (using the
archive search tool, scoped to the target), and reports a relevance rating plus specific, cited
findings — or says plainly that nothing substantive connects them. A finding can be promoted into the
source Project's memory, with where it came from recorded alongside it.

The Projects never merge. Only the connection between them becomes visible, and only when you ask.

---

## Settings

- **Providers** — API keys for Anthropic and/or OpenRouter, stored locally. OpenRouter's model catalog
  refreshes automatically when you save its key, or on demand via **Refresh models**.
- **Model roles** — the mechanism that makes Magi model-agnostic in practice. Every part of Magi asks
  for a *role* ("the reasoner," "the critic"), never a specific model. Reassign a role here — to any
  model from any configured provider — and every caller upgrades at once. If an OpenRouter model
  doesn't support tool use, its entry is labeled "no tool use" in the dropdown so you know before you
  assign it somewhere that needs tools.
- **Tools & permissions** — currently one real toggle: whether `search_archive` may look beyond the
  current Project. Off restricts it to the current Project only, for every conversation, Council, and
  Agent.

---

## A few practical notes

- **If a model seems to think for a long time and then answer strangely** (or with nothing) — this was
  a real bug class found and fixed during development: some models default to spending their entire
  turn on hidden "reasoning" before ever producing a visible answer. Magi now asks OpenRouter models to
  keep that reasoning effort low by default (higher for roles that benefit from deeper thought — the
  Reasoner and Synthesizer roles specifically). If a particular model still misbehaves, try a different
  one for that role; not every model handles agentic, tool-using turns equally well.
- **Fast, cheap models are a reasonable default** for the Default and Fast roles; save the more
  expensive or reasoning-heavy models for Reasoner and Synthesizer, where the extra depth is more
  likely to matter.
- **Everything is local.** There's no account, no sync, no cloud copy. Use Export if you want a backup
  or want to move a Project somewhere else.

---

## What's not here yet

Cost visibility, granular per-Skill/per-Agent permissions beyond the cross-Project toggle, automatic
model recommendation, true semantic (meaning-based, as opposed to keyword) search, importing from other
AI products' export formats, and Brand Libraries are all part of the larger vision but not built yet.
See the Handoff document for the full list and the reasoning behind what got prioritized.
