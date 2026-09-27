// Turning a Council's conclusion into what the Project has decided.
//
// A deliberation ends with a synthesis — often long, hedged, and written for
// reading once. What the Project needs to carry forward is shorter: the
// decision, stated plainly, and — if the Council left something unresolved —
// the open question. This drafts both from the conclusion, the user edits and
// records them, and they land as the Project's own decisions and open
// questions (project_notes), linked back to the deliberation. From there they
// appear in "Where the work stands" and in every later conversation's context
// (see buildSystemPrompt).
//
// Recording is the deliberate act: nothing is written until the user records
// it, and what they record is settled/open straight away, the same as a note
// they typed by hand.
import { getModel, modelForRole, reasoningEffortForRole } from "@/lib/models/registry";
import type { TokenUsage } from "@/lib/models/types";
import { recordUsage } from "@/lib/repo/usage";
import { getCouncilRun } from "@/lib/repo/councils";
import { createProjectNote, listNotesForCouncilRun, type ProjectNote } from "@/lib/repo/projectNotes";

const DECISION_START = "<<<DECISION>>>";
const QUESTION_START = "<<<OPEN QUESTION>>>";
const END = "<<<END>>>";

function between(reply: string, start: string): string | null {
  const at = reply.indexOf(start);
  if (at === -1) return null;
  const body = reply.slice(at + start.length);
  const end = body.indexOf(END);
  const text = (end === -1 ? body : body.slice(0, end)).trim().replace(/^["“']|["”']$/g, "").trim();
  return text && !/^none\.?$/i.test(text) ? text : null;
}

// Only what's between the delimiters, so a model that reasons out loud first
// never has its reasoning recorded as a decision. A reply without a decision
// block is a failed draft, not an empty one.
export function readDecisionDraft(reply: string): { decision: string; openQuestion: string | null } {
  const decision = between(reply, DECISION_START);
  if (!decision) throw new Error("The draft didn't contain a decision.");
  return { decision, openQuestion: between(reply, QUESTION_START) };
}

export async function draftCouncilDecision(runId: string): Promise<{ decision: string; openQuestion: string | null }> {
  const run = getCouncilRun(runId);
  if (!run || run.status !== "complete") throw new Error("The Council hasn't reached a conclusion to record.");
  const modelId = modelForRole("fast");
  const resolved = getModel(modelId);
  if (!resolved || !resolved.provider.isConfigured()) throw new Error("No model is configured to draft with.");
  const usage: TokenUsage[] = [];
  const raw = await resolved.provider.complete({
    model: modelId,
    system:
      "You turn a Council's conclusion into a Project's record. Write the decision it reached as one or two plain " +
      "sentences, stated as settled (e.g. \"Use Postgres for new services; revisit if write volume passes 10k/s.\") — " +
      "include a condition or caveat only if the conclusion depends on it. Then, only if the Council left something " +
      "genuinely unresolved, write that as one open question; otherwise write None. No preamble, no commentary. " +
      `Format exactly:\n${DECISION_START}\n<decision>\n${END}\n${QUESTION_START}\n<question or None>\n${END}`,
    messages: [
      {
        role: "user",
        content:
          `Question put to the Council:\n${run.question}\n\nConclusion:\n${run.synthesis ?? ""}` +
          (run.disagreement ? `\n\nWhere the Council disagreed:\n${run.disagreement}` : "") +
          (run.consensus ? `\n\nConsensus: ${run.consensus}` : ""),
      },
    ],
    maxTokens: 2000,
    usage,
    reasoningEffort: reasoningEffortForRole("fast"),
  });
  recordUsage({
    projectId: run.project_id,
    source: "council",
    sourceId: run.id,
    provider: resolved.provider.id as "anthropic" | "openrouter" | "chutes",
    model: modelId,
    role: "decision_draft",
    usage,
  });
  return readDecisionDraft(raw);
}

export function recordCouncilDecision(
  runId: string,
  input: { decision: string; openQuestion?: string | null }
): ProjectNote[] {
  const run = getCouncilRun(runId);
  if (!run) throw new Error("Council run not found");
  if (!run.project_id) throw new Error("This deliberation isn't in a Project, so there's nowhere to record a decision.");
  const decision = input.decision.trim();
  if (!decision) throw new Error("Nothing to record.");
  const common = { projectId: run.project_id, conversationId: run.conversation_id, councilRunId: run.id };
  createProjectNote({ ...common, kind: "decision", content: decision, status: "settled" });
  const question = input.openQuestion?.trim();
  if (question) createProjectNote({ ...common, kind: "question", content: question, status: "open" });
  return listNotesForCouncilRun(run.id);
}
