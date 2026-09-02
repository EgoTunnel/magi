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

**Where the work stands** sits at the top of every Project, above its contents, and answers the question
you actually have when you open one: what's unresolved, what's settled, and what has been happening.

- **Open questions** and **Decisions** — closing a conversation proposes these, and they arrive tagged
  `PROPOSED` with **Keep** and discard beside them. You can also write either by hand with the **+**;
  anything you type yourself skips the proposal step, since writing it is already the deliberate part.
  Resolve a question when it stops being open.
- **Recent activity** — the last dozen things that happened here, of any kind, each a link. No single
  kind can flood it: an afternoon of image generation shows up as an afternoon of image generation, not
  as the entire history of the Project.

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

**Export** (top of the Project page) downloads everything above as one JSON file. **Import** (on the
Projects list page) reads that file back as a brand-new Project — useful for backing work up, moving it
to another Magi install, or just keeping an archive outside the app.

The same **Import** button also accepts a `conversations.json` from a ChatGPT or Claude data export
(Settings → Export/Privacy on either service). If you were handed a `.zip`, extract it first and select
`conversations.json` from inside. Magi detects which format it's looking at automatically — there's
nothing to pick. Everything lands as one new Project (e.g. "Imported from ChatGPT — Aug 29, 2026")
holding every conversation from the file; it isn't sorted into multiple Projects by topic. Only the
conversation text comes across — no images/attachments, and for ChatGPT specifically, only your actual
back-and-forth (tool/plugin/browsing steps aren't imported). If a conversation had an edited or
regenerated message, Magi keeps the version you ended up seeing, not the discarded draft.

---

## Conversations

Open one from inside a Project. Two dropdowns sit above the message box:

- **Skill** — optionally invoke a reusable method for this turn (see below). If the Skill has its own
  tool allowlist, it applies for as long as that Skill is active.
- **Model role** — which role should answer: Default, Reasoner, Writer, Critic, Researcher,
  Synthesizer, Fast, or **Auto**. Roles map to models in Settings, not the other way around. Auto asks
  a small, cheap model to classify the task first (a real model call, not a keyword guess) and picks
  the best-fit role for you — it's opt-in, not the default, since it adds one extra round-trip and a
  small extra cost to every turn that uses it (both are visible in Settings → Usage & cost, logged
  under role "classifier").

Type and send. Responses stream in. The model can search your archive or do arithmetic mid-answer —
click **Context** in the top right to see exactly what a given reply drew on: which Project
instructions applied, how much memory was in play, which tools it actually called, and — on an Auto
turn — which role got picked.

The **Retrieved for this message** list is the important part. Magi doesn't hand the model the front
of every document and hope the answer is in there; it indexes everything in the Project as passages
and, for each message you send, pulls the passages that actually bear on what you asked — from
documents, past conversations, artifacts, and memory alike. Each one shows its source, its date, and
whether it matched on meaning, on wording, or both, and the reply cites them as [P1], [P2]. A Project
with a million characters of material can therefore answer from the relevant thousand, rather than
from whichever document you happened to add first.

Every passage title there is a link. Click one and you land on the exact message, document, or artifact
it was taken from — the message it points at is marked when you arrive. "Where did that come from?" has
an answer you can follow.

Meaning-matching needs an embedding model (Settings → Search index). Without one, retrieval still
works on wording alone — it just won't catch a question phrased differently than your notes were.

**Long conversations.** Past a certain length Magi stops sending every message every turn. The most recent
turns go as they are; everything older is replaced by a rolling summary it keeps up to date as you go. The
Context panel says when this is happening and how many messages it covers. Short conversations are
unaffected, and nothing is deleted — the full transcript stays on the page and in your archive.

**Closing an episode.** A conversation is an episode, and episodes end. **Close episode** in the top right
reads the whole thing and drafts four things: a summary, the decisions it settled, the questions it left
open, and what might be worth remembering — separated into facts about this Project and facts about you.

Nothing it proposes is in effect. Suggested memory is never used in a reply, and proposed decisions and
questions don't reach the Project, until you press **Keep** on them. Discard the rest with the bin icon.
Whatever you don't get to stays where it is — suggestions collect on the Memory page under **Suggested**,
so nothing is lost by closing the panel. You can draft again at any point; redrafting replaces what you
haven't kept and leaves what you have.

Hover an assistant message for three actions:

- **Remember in Project** / **Remember globally** — promotes that message into memory. Nothing
  becomes memory on its own; you decide. Magi records which message it came from, so the Memory page can
  link you back to it later.
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

- **Search** — search across everything Magi holds. A **Wording / Meaning** toggle switches between
  full-text keyword search and semantic search: Meaning finds content related to your query even when
  it doesn't share any of the same words (it requires an OpenRouter key and an embedding model chosen
  in Settings — see below). Semantic results show a match percentage instead of a highlighted excerpt.
- **Ask** — ask a question in plain language; Magi searches the archive and synthesizes an answer,
  citing which sources it used. If nothing relevant exists, it says so rather than guessing.

---

## Skills

A Skill is a reusable *method*, not just a tool — a named, saved set of instructions for how to
approach a class of task (e.g. "Research," "Literature Review"). Create one from the **Skills** page,
scoped either globally or to one Project. Three starters are offered when you have none yet: Research,
Writing, and Historical Research. Invoke a Skill from any conversation in its scope via the Skill
dropdown.

A Skill has four parts, and only the first is required:

- **Method** — the instructions themselves.
- **Model role** — which model this method wants. It applies when you haven't picked a role yourself;
  an explicit choice in the composer, or an Auto turn, still wins.
- **Stages** — leave empty for an ordinary Skill. Add stages and the Skill becomes a pipeline: an Agent
  given it runs those stages in order instead of its built-in plan/research/draft/critique/revise
  sequence, and each stage sees everything the earlier ones produced. Each stage can name its own model
  role and say whether it may use tools — usually only the stage that has to look things up should.
- **Tools allowed** — leave everything checked for no restriction beyond what's globally enabled in
  Settings. A Skill can only ever narrow what it's used with, never widen it.

Click any Skill in the list to edit it.

Skills compose with the rest of Magi rather than sitting beside it. An **Agent** can be given a Skill as
its method (the **Method** dropdown when you start one). A **Council** member can work by a Skill — the
Skill supplies the method, the role supplies who is applying it. The Research starter is a worked
example of a staged Skill: Frame → Gather → Cross-check → Synthesize, with tools only on Gather.

---

## Over time

The third mode on the **Archive** page answers the questions only your own archive can: when a topic
first came up, how often since, and what you were saying about it at each point. Type a topic and press
**Trace this topic**.

You get the true first and most recent dates, a count of matching passages in each month or quarter, and
the passages that best represent each period — each one a link back to where it came from. The counts are
complete; the passages are a sample, so a quiet period may show a count with nothing under it, and it
says so when that happens.

**Describe how it changed** hands the timeline to a model to characterize the development. It's a
separate button because it's the only part that costs anything — the timeline itself is free. Magi is
instructed to be honest about the shape of the evidence: if your thinking on something has been stable,
or there's simply too little to say, it will tell you that rather than inventing an arc.

In a conversation, asking about time or change directly ("when did I first start thinking about X?")
does the same thing — Magi has a `trace_thinking` tool for exactly this and will use it instead of an
ordinary archive search.

---

## Magi Council

From the **Councils** page, put a substantial question to several models at once, in one of three
modes:

- **Independent Analysis** (default: Reasoner, Critic, Researcher) — each role analyzes independently,
  then reads and critiques the others' analyses, then a Synthesizer reconciles everything into a final
  answer.
- **Debate** (default: Advocate, Skeptic — exactly 2 roles) — both sides state their position, then each
  responds directly to the other's argument, then a Synthesizer characterizes the disagreement.
- **Red Team** (default: Proposer, Red Team — 2 or more roles) — the Proposer answers the question, the
  Red Team role(s) attack it aggressively, the Proposer defends, then a Synthesizer assesses which
  attacks actually held up.

In every mode, the Synthesizer explicitly **preserves disagreement** rather than smoothing it over —
Debate's synthesis never declares a winner, and Red Team's never simply says "the attack won" or "the
proposal survived." The result page shows a Consensus rating (Strong/Moderate/Weak/None), the specific
disagreement if there is one, and the full transcript by stage.

You can also save a named Council configuration (custom roles, custom system prompts, each assigned a
model role) to reuse later, instead of a default preset — any saved Council can be run through any of
the three modes, as long as its role count fits (exactly 2 for Debate, 2+ for Red Team).

---

## Agents

An Agent is more autonomous than a Skill: give it an objective from a Project's **Agents** section, and
it plans, researches (using the archive and a calculator), drafts, critiques itself, revises, and saves
the result as a Project artifact — all without further input from you. Open the run to watch it work
step by step, live. **Stop** halts it after its current step finishes (not mid-generation).

An Agent can only search the archive and calculate; it cannot send messages, modify files, or take any
action outside the task. Which of those two tools a given run may actually use is chosen when you
launch it — Agents have no persistent template to save permissions on, so it's a per-run choice rather
than a per-Agent one.

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
  assign it somewhere that needs tools. Each role also has its own reasoning-effort dropdown
  (None/Low/Medium/High/Xhigh/Max) — how hard that role's model should think before answering. Only
  applies to OpenRouter models and is automatically adjusted down to whatever the assigned model
  actually supports; Anthropic's API has no equivalent control.
- **Tools & permissions** — a per-tool on/off switch for everything Magi can call
  (`search_archive`, `calculator`). Turning one off applies everywhere it's used: conversations, Agents,
  Councils, and Connections. Below that, the cross-Project search toggle: whether `search_archive` may
  look beyond the current Project. Skills and individual Agent runs can narrow these further for
  themselves, but never turn something back on that's off here.
- **Semantic search** — requires an OpenRouter key (Anthropic has no embeddings API). Pick an embedding
  model, then click **Build index** once to cover everything already in your archive — new and edited
  content is embedded automatically from then on. Switching the embedding model later doesn't delete
  anything already indexed; it just goes unused until you either switch back or rebuild the index for
  the new model.
- **Usage & cost** — every model call anywhere in Magi (conversations, Agents, Councils, Connections,
  archive questions) is logged with its token counts. Cost in dollars is computed automatically for
  OpenRouter models, straight from their own live pricing catalog. Anthropic doesn't publish pricing
  through its API, so its calls show tokens only until you enter a rate here yourself (dollars per
  million input/output tokens, per model) — nothing is ever guessed. A running total for today also
  shows in the status bar at the bottom of the window, and a per-turn breakdown appears in a
  conversation's Context panel.

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
