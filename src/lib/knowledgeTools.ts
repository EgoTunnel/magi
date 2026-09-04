import { search, semanticSearch, type SearchResult } from "@/lib/searchIndex";
import { ensureChunkIndex, retrieveChunks } from "@/lib/retrieval";
import { traceTrajectory, trajectoryDigest } from "@/lib/trajectory";
import { getCrossProjectSearchEnabled, getEmbeddingModelId, getOpenRouterApiKey } from "@/lib/settings";
import { listPeople, lookupPerson } from "@/lib/repo/people";
import { familyProjectIds } from "@/lib/repo/projects";

// The three read-only archive tools, separated from the rest of the tool layer
// because they now have two callers rather than one: Magi's own models
// (src/lib/tools/registry.ts) and the MCP server that exposes the archive to
// outside coding agents (src/mcp/server.ts).
//
// The split is about what gets loaded, not just about tidiness. registry.ts
// pulls in Pyodide, QuickJS, and the docx/xlsx/pptx writers at import time —
// tens of megabytes a stdio server would pay for on every launch and never
// use. Nothing here reaches past SQLite and, when a query needs embedding, one
// OpenRouter call.
//
// These return prose rather than structured data on purpose: the output is
// read by a model, and every caller wants the same wording.

export interface ArchiveScope {
  // The Project the caller is working in, if any. Absent means unscoped, which
  // for search means "everything" — an MCP client that never names a Project
  // gets the whole archive rather than nothing.
  projectId?: string | null;
  // "all" widens past the current Project, subject to the cross-Project
  // setting. Anything else keeps to the current Project's hierarchy.
  scope?: string;
}

export async function searchArchive(query: string, opts: ArchiveScope = {}): Promise<string> {
  const wantsAll = opts.scope === "all";
  const crossProjectAllowed = wantsAll && getCrossProjectSearchEnabled();
  // Not "all": search this Project's whole hierarchy branch — itself, every
  // ancestor it inherits context from, and every descendant a meta-project's
  // members live in — not just the one row's own id.
  const scopeProjectId = crossProjectAllowed ? undefined : opts.projectId ? familyProjectIds(opts.projectId) : undefined;

  // Passage retrieval: real extracts of the matching material rather than a
  // 24-token keyword window around the hit, and hybrid, so a question phrased
  // differently than the archive's own wording still lands. This is the same
  // machinery context assembly uses (src/lib/retrieval.ts).
  ensureChunkIndex();
  const passages = await retrieveChunks(query, { projectId: scopeProjectId, limit: 8 }).catch(() => []);
  if (passages.length) {
    return passages
      .map((p, i) => {
        const elsewhere = p.projectId && p.projectId !== opts.projectId ? ", from another Project" : "";
        const kind = p.kind === "style_guide" ? "style guide" : p.kind;
        return `[${i + 1}] (${kind}${elsewhere}, ${p.sourceDate.slice(0, 10)}) ${p.title}\n${p.content}`;
      })
      .join("\n\n");
  }

  // Nothing in the passage index matched — fall back to the whole-item keyword
  // index, which still covers rows too short to have produced a passage (a
  // conversation title, a one-line memory item).
  let results: SearchResult[] = search(query, { projectId: scopeProjectId, limit: 10 });
  let matchedByMeaning = false;
  if (results.length === 0 && getEmbeddingModelId() && getOpenRouterApiKey()) {
    try {
      const semanticResults = await semanticSearch(query, { projectId: scopeProjectId, limit: 10 });
      if (semanticResults.length) {
        results = semanticResults;
        matchedByMeaning = true;
      }
    } catch {
      // Fall through to "No matches found" below.
    }
  }
  if (results.length === 0) {
    return wantsAll && !crossProjectAllowed
      ? "No matches in this Project. Cross-Project search is turned off in Settings, so other Projects were not searched."
      : "No matches found.";
  }
  const header = matchedByMeaning ? "(matched by meaning/topic, not exact wording)\n\n" : "";
  return (
    header +
    results
      .map((r, i) => {
        const elsewhere = r.projectId && r.projectId !== opts.projectId ? ", from another Project" : "";
        return `[${i + 1}] (${r.kind}${elsewhere}) ${r.title}\n${r.snippet.replace(/⟦|⟧/g, "")}`;
      })
      .join("\n\n")
  );
}

export async function traceThinking(topic: string, opts: ArchiveScope = {}): Promise<string> {
  // Unlike searchArchive, this defaults to every Project: a question about how
  // thinking developed is rarely bounded by where the thinking happened to be
  // filed. The cross-Project setting still governs it.
  const restrict = opts.scope === "this_project" || !getCrossProjectSearchEnabled();
  const scopeProjectId = restrict && opts.projectId ? familyProjectIds(opts.projectId) : undefined;

  const trajectory = await traceTrajectory(topic, { projectId: scopeProjectId });
  if (trajectory.totalPassages === 0) return "Nothing in the archive touches on this topic.";

  const header =
    `${trajectory.totalPassages} passages about "${topic}", from ` +
    `${trajectory.firstDate?.slice(0, 10)} to ${trajectory.lastDate?.slice(0, 10)} ` +
    `(${trajectory.spanDays} days).\n` +
    (restrict ? "Scope: this Project and its hierarchy.\n" : "Scope: every Project.\n");
  return `${header}\n${trajectoryDigest(trajectory)}`;
}

export async function describePerson(who: string): Promise<string> {
  ensureChunkIndex();
  const found = await lookupPerson(who);
  if (!found) {
    // Naming who *is* known is the difference between a dead end and a usable
    // answer — and it is also the guard against the model deciding that a
    // near-miss must be the same human. Matching is exact by design; the model
    // is told plainly that it is.
    const known = listPeople({ status: "established" }).map((p) => p.name);
    if (!known.length) return `No one named "${who}" is recorded, and no people have been recorded yet.`;
    return (
      `No one named "${who}" is recorded. Names are matched exactly (including recorded aliases) — do not ` +
      `assume a similar name is the same person. Recorded people: ${known.slice(0, 40).join(", ")}` +
      (known.length > 40 ? `, and ${known.length - 40} more.` : ".")
    );
  }

  const lines = [`${found.person.name}${found.person.relationship ? ` — ${found.person.relationship}` : ""}`];
  if (found.person.aliases.length) lines.push(`Also known as: ${found.person.aliases.join(", ")}`);
  if (found.person.summary) lines.push(found.person.summary);
  if (found.projects.length) lines.push(`\nProjects: ${found.projects.map((p) => p.name).join(", ")}`);

  lines.push(
    found.facts.length
      ? `\nWhat the user has recorded about them:\n` +
          found.facts.map((f) => `- (${f.created_at.slice(0, 10)}) ${f.content}`).join("\n")
      : `\nThe user has not recorded any facts about them yet.`
  );
  if (found.mentions.length) {
    lines.push(
      `\nMentioned in:\n` +
        found.mentions
          .map((m) => `- (${m.sourceDate.slice(0, 10)}) ${m.title}\n  ${m.content.replace(/\s+/g, " ").slice(0, 400)}`)
          .join("\n")
    );
  }
  return lines.join("\n");
}
