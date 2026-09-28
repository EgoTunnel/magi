import { db, nowIso } from "@/lib/db";
import { getModel, modelForRole, reasoningEffortForRole } from "@/lib/models/registry";
import type { TokenUsage } from "@/lib/models/types";
import { recordUsage } from "@/lib/repo/usage";
import { createMemory, supersedeMemory, type MemoryItem } from "@/lib/repo/memory";
import { listProjects } from "@/lib/repo/projects";
import { addPersonFact, findPersonByName, listPeople } from "@/lib/repo/people";
import { getSetting, setSetting } from "@/lib/settings";

// Imported memory arrives as somebody else's format. A Claude account export
// carries a single account-wide summary plus one blob per memory file, and
// importClaudeAccountExport writes each one as a global, established row —
// verbatim, YAML frontmatter and all. The result is a handful of large,
// multi-claim items that reach every prompt Magi builds, most of which are
// really about one Project or one person.
//
// This pass rewrites them into Magi's own idiom: one atomic claim per row,
// routed to the Project or person it belongs to, and proposed rather than
// adopted. The original rows are superseded, not deleted — they stay readable
// as history and can be restored, but they stop reaching prompts.
//
// Output is delimited, labeled lines rather than JSON, matching the convention
// in episodeClose.ts and connections.ts: more robust across providers, and a
// line the model drifts on is skipped rather than sinking the whole parse.

const OUTPUT_START = "<<<CURATION>>>";
const OUTPUT_END = "<<<END>>>";

const CURATION_SYSTEM_PROMPT =
  "You are re-filing a block of imported memory into a personal knowledge system. The block came from " +
  "another AI assistant's export, so it may carry that system's formatting — YAML frontmatter, " +
  "\"[stated]\" markers, bullet lists, export artifacts. Strip all of that. Keep only the substance.\n\n" +
  "Split the block into ATOMIC CLAIMS: one fact per line, each a plain declarative sentence that will " +
  "still make sense on its own in a year, with no \"the above\" and no \"as discussed\". A block that " +
  "states six things becomes six lines. Never merge two facts onto one line.\n\n" +
  "Then route each claim to exactly one destination:\n\n" +
  "GLOBAL — durable facts about the USER that apply no matter what they are working on: who they are, " +
  "their role and background, how they want to be worked with, stable circumstances. Be strict. Most " +
  "claims are not global.\n" +
  "PROJECT — facts about one specific body of work. Use the exact Project name from the list below.\n" +
  "PERSON — facts about a person the user has a working relationship with. Use the exact recorded name " +
  "from the list below. Never route to a person who is not on that list, and never assume a similar name " +
  "is the same human.\n" +
  "NEWPROJECT — facts about a specific body of work that has NO Project in the list yet. Invent a short " +
  "Project name for it and use the same name for every claim belonging to that work.\n" +
  "DROP — content not worth keeping at all: duplicated statements, throwaway trivia, or narrative " +
  "summary that restates other claims rather than adding a fact.\n\n" +
  `Put your entire answer between a line containing exactly ${OUTPUT_START} and a line containing exactly ` +
  `${OUTPUT_END}. Anything outside those markers is discarded, so do all of your thinking before the ` +
  "opening marker and write nothing after the closing one.\n\n" +
  "Inside the markers write nothing but claim lines, each in one of these exact forms:\n\n" +
  "GLOBAL :: <the claim>\n" +
  "PROJECT <exact Project name> :: <the claim>\n" +
  "PERSON <exact person name> :: <the claim>\n" +
  "NEWPROJECT <short project name> :: <the claim>\n" +
  "DROP <why> :: <what you dropped>\n\n" +
  "No headings, no preamble, no commentary, no blank-line grouping. One claim per line.";

export type Destination = "global" | "project" | "person" | "newproject" | "drop";

export interface CuratedClaim {
  destination: Destination;
  // Project name, person name, or proposed Project name — absent for GLOBAL,
  // and the reason for DROP.
  target: string | null;
  claim: string;
}

// Deliberately permissive about spacing and about a leading bullet: models
// reach for "- " out of habit even when told not to, and rejecting the line
// over it would throw away a perfectly good claim.
const LINE = /^\s*(?:[-*]\s*)?(GLOBAL|PROJECT|PERSON|NEWPROJECT|DROP)\b\s*(.*?)\s*::\s*(.+?)\s*$/i;

export function parseCuration(raw: string): CuratedClaim[] {
  const start = raw.indexOf(OUTPUT_START);
  const end = raw.indexOf(OUTPUT_END, start === -1 ? 0 : start);
  // A model that omits the markers entirely still parses — the whole reply is
  // used, the same fallback episodeClose.ts takes.
  const body =
    start === -1 || end === -1 ? raw : raw.slice(start + OUTPUT_START.length, end);

  const out: CuratedClaim[] = [];
  for (const line of body.split("\n")) {
    const m = LINE.exec(line);
    if (!m) continue;
    const destination = m[1].toLowerCase() as Destination;
    const target = m[2].trim() || null;
    const claim = m[3].trim();
    if (!claim) continue;
    // A bare "GLOBAL" carries no target; the others are meaningless without one.
    if (destination !== "global" && destination !== "drop" && !target) continue;
    out.push({ destination, target: destination === "global" ? null : target, claim });
  }
  return out;
}

export interface CurationOutcome {
  sourceId: string;
  kept: number;
  dropped: number;
  // Claims whose target could not be resolved — a Project or person the model
  // named that does not exist. Reported rather than silently rerouted.
  unresolved: Array<{ target: string; claim: string }>;
  // Proposed Projects that do not exist yet, with the claims that want them.
  proposedProjects: Array<{ name: string; claims: string[] }>;
  created: MemoryItem[];
}

// Applies one block's worth of claims. Everything lands as 'suggested': this is
// a machine re-reading somebody else's notes, which is exactly the case the
// deliberate-memory rule exists for. Nothing here reaches a prompt or the
// search index until a human keeps it.
export function applyCuration(sourceId: string, claims: CuratedClaim[]): CurationOutcome {
  const outcome: CurationOutcome = {
    sourceId,
    kept: 0,
    dropped: 0,
    unresolved: [],
    proposedProjects: [],
    created: [],
  };
  const projectsByName = new Map(
    [...listProjects({ status: "active" }), ...listProjects({ status: "archived" })].map((p) => [
      p.name.toLowerCase(),
      p.id,
    ])
  );
  const proposed = new Map<string, string[]>();

  for (const c of claims) {
    if (c.destination === "drop") {
      outcome.dropped++;
      continue;
    }

    if (c.destination === "global") {
      outcome.created.push(
        createMemory({ scope: "global", content: c.claim, source: "import-curation", status: "suggested" })
      );
      outcome.kept++;
      continue;
    }

    if (c.destination === "person") {
      const person = c.target ? findPersonByName(c.target) : null;
      if (!person) {
        outcome.unresolved.push({ target: c.target ?? "?", claim: c.claim });
        continue;
      }
      outcome.created.push(
        addPersonFact({ personId: person.id, content: c.claim, source: "import-curation", status: "suggested" })
      );
      outcome.kept++;
      continue;
    }

    if (c.destination === "project") {
      const projectId = c.target ? projectsByName.get(c.target.toLowerCase()) : undefined;
      if (!projectId) {
        outcome.unresolved.push({ target: c.target ?? "?", claim: c.claim });
        continue;
      }
      outcome.created.push(
        createMemory({
          scope: "project",
          projectId,
          content: c.claim,
          source: "import-curation",
          status: "suggested",
        })
      );
      outcome.kept++;
      continue;
    }

    // NEWPROJECT: the work has no home yet. Creating Projects unasked is not
    // this pass's call — a Project is a top-level thing the user organises
    // their life around. The claim is kept as a global suggestion so nothing
    // is lost, and the proposed name is reported so the user can act on it.
    if (c.destination === "newproject" && c.target) {
      const existing = projectsByName.get(c.target.toLowerCase());
      if (existing) {
        outcome.created.push(
          createMemory({
            scope: "project",
            projectId: existing,
            content: c.claim,
            source: "import-curation",
            status: "suggested",
          })
        );
      } else {
        proposed.set(c.target, [...(proposed.get(c.target) ?? []), c.claim]);
        outcome.created.push(
          createMemory({
            scope: "global",
            content: c.claim,
            source: `import-curation (wants Project "${c.target}")`,
            status: "suggested",
          })
        );
      }
      outcome.kept++;
    }
  }

  outcome.proposedProjects = [...proposed.entries()].map(([name, claims]) => ({ name, claims }));
  return outcome;
}

function projectRoster(): string {
  const projects = listProjects({ status: "active" });
  if (!projects.length) return "(none yet)";
  return projects
    .map((p) => `- ${p.name}${p.purpose ? `: ${p.purpose.replace(/\s+/g, " ").slice(0, 200)}` : ""}`)
    .join("\n");
}

function peopleRoster(): string {
  const people = listPeople({ status: "established" });
  if (!people.length) return "(none yet)";
  return people.map((p) => `- ${p.name}${p.relationship ? ` — ${p.relationship}` : ""}`).join("\n");
}

// One model call per imported block. Blocks are independent, and a block that
// fails to curate leaves the original row untouched rather than half-processed.
export async function curateBlock(item: { id: string; content: string }): Promise<CurationOutcome> {
  const role = "reasoner";
  const modelId = modelForRole(role);
  const resolved = getModel(modelId);
  if (!resolved || !resolved.provider.isConfigured()) throw new Error("NO_API_KEY");

  const usage: TokenUsage[] = [];
  const raw = await resolved.provider.complete({
    model: modelId,
    system: CURATION_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content:
          `The user's existing Projects:\n${projectRoster()}\n\n` +
          `The user's recorded people:\n${peopleRoster()}\n\n` +
          `The imported memory block to re-file:\n---\n${item.content}\n---`,
      },
    ],
    maxTokens: 4000,
    reasoningEffort: reasoningEffortForRole(role),
    usage,
  });
  recordUsage({
    projectId: null,
    source: "import_curation",
    sourceId: item.id,
    provider: resolved.provider.id as "anthropic" | "openrouter" | "chutes",
    model: modelId,
    role,
    usage,
  });

  const outcome = applyCuration(item.id, parseCuration(raw));
  // Only once its replacements exist. Superseding keeps the original readable
  // as history while taking it out of every prompt and out of search — the
  // same posture a fact that stopped being true gets, and reversible from the
  // Memory page.
  if (outcome.kept > 0 || outcome.dropped > 0) supersedeMemory(item.id, null);
  return outcome;
}

// ---------------------------------------------------------------------------
// The job. Same shape as the embedding backfill (src/lib/embeddingBackfill.ts):
// a singleton tracked in one settings row, since there is no run history worth
// keeping — only "is it running, how far did it get, and what did it do".
// ---------------------------------------------------------------------------

const STATUS_KEY = "import_curation_status";

export interface CurationStatus {
  status: "idle" | "running" | "complete" | "error";
  processed: number;
  total: number;
  kept: number;
  dropped: number;
  unresolved: Array<{ target: string; claim: string }>;
  proposedProjects: Array<{ name: string; claims: string[] }>;
  error?: string;
  updatedAt: string;
}

const IDLE: CurationStatus = {
  status: "idle",
  processed: 0,
  total: 0,
  kept: 0,
  dropped: 0,
  unresolved: [],
  proposedProjects: [],
  updatedAt: "",
};

export function getCurationStatus(): CurationStatus {
  const raw = getSetting(STATUS_KEY);
  if (!raw) return IDLE;
  try {
    return { ...IDLE, ...(JSON.parse(raw) as CurationStatus) };
  } catch {
    return IDLE;
  }
}

function setCurationStatus(status: CurationStatus) {
  setSetting(STATUS_KEY, JSON.stringify(status));
}

// What this pass is for: rows an importer wrote verbatim, still established and
// still global. Project-scoped imports are left alone — they are already filed,
// and re-filing them would move work the user deliberately organised.
export function listUncuratedImports(): Array<{ id: string; content: string }> {
  return db
    .prepare(
      `SELECT id, content FROM memory
       WHERE source = 'import' AND scope = 'global' AND status = 'established'
       ORDER BY length(content) DESC`
    )
    .all() as Array<{ id: string; content: string }>;
}

export async function runImportCuration(): Promise<CurationStatus> {
  if (getCurationStatus().status === "running") return getCurationStatus();

  const items = listUncuratedImports();
  const status: CurationStatus = { ...IDLE, status: "running", total: items.length, updatedAt: nowIso() };
  setCurationStatus(status);

  if (!items.length) {
    const done = { ...status, status: "complete" as const, updatedAt: nowIso() };
    setCurationStatus(done);
    return done;
  }

  const proposed = new Map<string, string[]>();
  try {
    for (const item of items) {
      // Sequential on purpose: each call sees the Projects and people the
      // previous ones may have routed to, and an import is a background job
      // nobody is watching a spinner for.
      const outcome = await curateBlock(item);
      status.processed++;
      status.kept += outcome.kept;
      status.dropped += outcome.dropped;
      status.unresolved.push(...outcome.unresolved);
      for (const p of outcome.proposedProjects) {
        proposed.set(p.name, [...(proposed.get(p.name) ?? []), ...p.claims]);
      }
      status.proposedProjects = [...proposed.entries()].map(([name, claims]) => ({ name, claims }));
      status.updatedAt = nowIso();
      setCurationStatus(status);
    }
    const done = { ...status, status: "complete" as const, updatedAt: nowIso() };
    setCurationStatus(done);
    return done;
  } catch (err) {
    // Whatever was curated before the failure stays curated — each block is
    // applied and superseded atomically, so a partial run is consistent and
    // re-running picks up only what is left.
    const failed = {
      ...status,
      status: "error" as const,
      error: err instanceof Error ? err.message : "Curation failed.",
      updatedAt: nowIso(),
    };
    setCurationStatus(failed);
    return failed;
  }
}
