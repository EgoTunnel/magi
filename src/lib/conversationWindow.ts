import { db, nowIso } from "@/lib/db";
import { getModel, modelForRole, reasoningEffortForRole } from "@/lib/models/registry";
import { recordUsage } from "@/lib/repo/usage";
import type { ModelMessage, TokenUsage } from "@/lib/models/types";
import type { Message } from "@/lib/repo/conversations";

// Every turn used to send the entire conversation. The largest real one here is
// 122 messages and ~890,000 characters, which is expensive long before it is
// impossible — and eventually it *is* impossible. So a conversation now has a
// live window of recent turns plus a rolling summary of everything older.
//
// 40,000 characters is roughly 10k tokens: enough that ordinary conversations
// (the overwhelming majority) never summarize anything at all and behave
// exactly as before, and long ones keep a substantial verbatim tail.
const WINDOW_CHAR_BUDGET = 40000;
// A floor that beats the budget: a handful of very long messages must still be
// sent whole rather than summarized down to nothing, or "regenerate that last
// answer" would lose the thing being regenerated.
const MIN_WINDOW_MESSAGES = 6;
const SUMMARY_MAX_TOKENS = 1200;
// How much of the older material is folded in one pass. The fold is
// incremental — only messages added since the last summary are re-read — so
// this cap is only ever hit by a conversation that grew enormously between
// summaries, or by the very first fold of an imported one.
const FOLD_CHAR_BUDGET = 120000;
// How much un-summarized older material a turn will carry verbatim rather than
// wait for a summarizer call to digest it.
//
// The fold used to happen inline, which meant the turns of a long conversation
// — the ones that already feel slow — paid a second model call (up to
// SUMMARY_MAX_TOKENS of generation) before the real answer could start. But
// what it summarizes has *already* aged out of the window: it is never the
// message being answered, so the summary is only ever needed for the turn
// after this one. So the fold now runs in the background, and this turn sends
// the not-yet-folded messages as they are.
//
// One window's worth is the ceiling on that: past it, sending everything
// verbatim is the cost windowing exists to avoid (the largest real
// conversation here is ~890,000 characters), so a backlog that big — a fresh
// import, or a first fold — is still worth waiting for once.
const ASYNC_FOLD_CHAR_LIMIT = 40000;

const SUMMARY_SYSTEM_PROMPT =
  "You maintain a running summary of the earlier part of a long conversation, for a model that will " +
  "only see your summary plus the most recent turns. Write for that reader, not for a human skimming.\n\n" +
  "Preserve, in this order of priority: decisions made and the reasoning behind them; facts, names, " +
  "numbers, and constraints established; work products produced and where they stand; open threads and " +
  "unresolved disagreements; the user's stated preferences about how they want things done. Drop " +
  "pleasantries, restatements, and anything already superseded by a later turn.\n\n" +
  "Write plain prose in past tense under short bold headings. Be specific — a summary that says " +
  "\"discussed the schedule\" is useless; \"settled on a Sept 21 live session, with the deck frozen the " +
  "Friday before\" is not. Never invent detail that isn't in the material. If an earlier summary is " +
  "provided, fold the new material into it and return one coherent summary of the whole, not an " +
  "addendum — and do not lose specifics the earlier summary already captured.";

export interface HistoryWindow {
  history: ModelMessage[];
  // Non-null only when older turns were actually left out of `history`.
  summary: string | null;
  summarizedCount: number;
  windowCount: number;
  // Present only when this call had to (re)generate the summary — the caller
  // records it against the conversation like any other model spend.
  usage: TokenUsage[];
  modelId: string | null;
  providerId: "anthropic" | "openrouter" | "chutes" | null;
}

interface SummaryState {
  summary: string | null;
  summary_through_id: string | null;
}

function toModelMessages(messages: Message[]): ModelMessage[] {
  return messages.map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
}

function transcript(messages: Message[]): string {
  return messages.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`).join("\n\n");
}

// Splits the conversation into "recent enough to send verbatim" and "old enough
// to summarize", newest-first from the tail. Exported because it is the whole
// of the windowing decision and the only part of this module testable without
// a provider.
export function splitWindow(messages: Message[]): { older: Message[]; window: Message[] } {
  let chars = 0;
  let start = messages.length;
  for (let i = messages.length - 1; i >= 0; i--) {
    const taken = messages.length - i;
    if (chars + messages[i].content.length > WINDOW_CHAR_BUDGET && taken > MIN_WINDOW_MESSAGES) break;
    chars += messages[i].content.length;
    start = i;
  }
  return { older: messages.slice(0, start), window: messages.slice(start) };
}

// One fold: `pending` folded onto `priorSummary` (when there is one), stored
// against the conversation, and returned. Throws on failure so each caller can
// decide what a failed fold means for it — the blocking path falls back to
// sending everything, the background one just leaves the summary as it was.
async function foldSummary(opts: {
  conversationId: string;
  priorSummary: string | null;
  pending: Message[];
  // Where the summary reaches once this fold lands, and how many messages it
  // then covers — the tail of `older`, not of `pending`, since a prior summary
  // already accounts for everything before it.
  throughId: string;
  coveredCount: number;
  usage: TokenUsage[];
}): Promise<{ summary: string; modelId: string; providerId: "anthropic" | "openrouter" | "chutes" }> {
  const modelId = modelForRole("fast");
  const resolved = getModel(modelId);
  if (!resolved || !resolved.provider.isConfigured()) throw new Error("No configured model for the summarizer");

  const priorBlock = opts.priorSummary ? `Summary of the conversation so far:\n\n${opts.priorSummary}\n\n---\n\n` : "";
  const newBlock = transcript(opts.pending).slice(-FOLD_CHAR_BUDGET);

  const summary = await resolved.provider.complete({
    model: modelId,
    system: SUMMARY_SYSTEM_PROMPT,
    messages: [{ role: "user", content: `${priorBlock}New material to fold in:\n\n${newBlock}` }],
    maxTokens: SUMMARY_MAX_TOKENS,
    usage: opts.usage,
    reasoningEffort: reasoningEffortForRole("fast"),
  });
  const trimmed = summary.trim();
  if (!trimmed) throw new Error("Summarizer returned nothing");

  db.prepare(
    `UPDATE conversations
     SET summary = ?, summary_through_id = ?, summary_message_count = ?, summary_updated_at = ?
     WHERE id = ?`
  ).run(trimmed, opts.throughId, opts.coveredCount, nowIso(), opts.conversationId);

  return {
    summary: trimmed,
    modelId,
    providerId: resolved.provider.id as "anthropic" | "openrouter" | "chutes",
  };
}

// One background fold per conversation at a time. Two turns in flight together
// (a regenerate started while a send is still streaming) would otherwise both
// schedule one, and the second would fold material the first is already
// folding.
const inFlightFolds = new Map<string, Promise<void>>();

// Extends the stored summary after the turn that noticed it was behind has
// already been answered. Nothing awaits this, so it must never reject and its
// spend has to be recorded here rather than handed back to a caller.
function scheduleFold(opts: {
  conversationId: string;
  priorSummary: string | null;
  pending: Message[];
  throughId: string;
  coveredCount: number;
}) {
  if (inFlightFolds.has(opts.conversationId)) return;
  const usage: TokenUsage[] = [];
  const run = foldSummary({ ...opts, usage })
    .then(({ modelId, providerId }) => {
      const row = db.prepare(`SELECT project_id FROM conversations WHERE id = ?`).get(opts.conversationId) as
        | { project_id: string }
        | undefined;
      recordUsage({
        projectId: row?.project_id ?? null,
        source: "conversation",
        sourceId: opts.conversationId,
        provider: providerId,
        model: modelId,
        role: "summarizer",
        usage,
      });
    })
    .catch((err) => {
      // The summary simply stays where it was; the next turn finds the same
      // pending material and tries again. Nothing about the conversation is
      // broken by a fold that didn't happen.
      console.error(
        `[conversationWindow] background summary fold failed for ${opts.conversationId}`,
        err instanceof Error ? err.message : err
      );
    })
    .finally(() => {
      inFlightFolds.delete(opts.conversationId);
    });
  inFlightFolds.set(opts.conversationId, run);
}

// Test seam: lets a suite wait for the background fold it triggered instead of
// racing it. Production code never calls this.
export function pendingFold(conversationId: string): Promise<void> | undefined {
  return inFlightFolds.get(conversationId);
}

// Builds the history actually sent to the model for one turn, generating or
// extending the conversation's rolling summary if the window has moved past
// material no existing summary covers.
//
// Never throws: if summarization fails (no key, a provider hiccup), the whole
// history is sent as before. That costs money and may eventually hit a context
// limit, but it is always better than refusing to answer.
export async function buildHistoryWindow(conversationId: string, messages: Message[]): Promise<HistoryWindow> {
  const usable = messages.filter((m) => m.role === "user" || m.role === "assistant");
  const { older, window } = splitWindow(usable);

  const everything = (): HistoryWindow => ({
    history: toModelMessages(usable),
    summary: null,
    summarizedCount: 0,
    windowCount: usable.length,
    usage: [],
    modelId: null,
    providerId: null,
  });

  if (older.length === 0) return everything();

  const state = (db
    .prepare(`SELECT summary, summary_through_id FROM conversations WHERE id = ?`)
    .get(conversationId) ?? { summary: null, summary_through_id: null }) as SummaryState;

  // Only the messages after the point the stored summary already reached need
  // reading again. A stored through-id that isn't in `older` any more (a
  // deleted message, an edited history) safely means "summarize all of it".
  const coveredThrough = state.summary
    ? older.findIndex((m) => m.id === state.summary_through_id)
    : -1;
  const pending = older.slice(coveredThrough + 1);
  const priorSummary = coveredThrough >= 0 ? state.summary : null;

  if (pending.length === 0 && state.summary) {
    return {
      history: toModelMessages(window),
      summary: state.summary,
      summarizedCount: older.length,
      windowCount: window.length,
      usage: [],
      modelId: null,
      providerId: null,
    };
  }

  const resolved = getModel(modelForRole("fast"));
  if (!resolved || !resolved.provider.isConfigured()) return everything();

  // The common case: a turn or two has aged out since the last fold. Answer
  // now with those carried verbatim, and let the fold catch up behind it.
  const pendingChars = pending.reduce((n, m) => n + m.content.length, 0);
  if (pendingChars <= ASYNC_FOLD_CHAR_LIMIT) {
    scheduleFold({
      conversationId,
      priorSummary,
      pending,
      throughId: older[older.length - 1].id,
      coveredCount: older.length,
    });
    return {
      history: toModelMessages([...pending, ...window]),
      summary: priorSummary,
      summarizedCount: older.length - pending.length,
      windowCount: pending.length + window.length,
      usage: [],
      modelId: null,
      providerId: null,
    };
  }

  const usage: TokenUsage[] = [];
  try {
    const { summary, modelId, providerId } = await foldSummary({
      conversationId,
      priorSummary,
      pending,
      throughId: older[older.length - 1].id,
      coveredCount: older.length,
      usage,
    });
    return {
      history: toModelMessages(window),
      summary,
      summarizedCount: older.length,
      windowCount: window.length,
      usage,
      modelId,
      providerId,
    };
  } catch (err) {
    console.error(
      `[conversationWindow] summary failed for ${conversationId}`,
      err instanceof Error ? err.message : err
    );
    return {
      ...everything(),
      // The failed call may still have consumed tokens before erroring.
      usage,
      modelId: resolved.model.id,
      providerId: resolved.provider.id as "anthropic" | "openrouter" | "chutes",
    };
  }
}

export function getConversationSummary(conversationId: string): { summary: string | null; count: number } {
  const row = db
    .prepare(`SELECT summary, summary_message_count FROM conversations WHERE id = ?`)
    .get(conversationId) as { summary: string | null; summary_message_count: number } | undefined;
  return { summary: row?.summary ?? null, count: row?.summary_message_count ?? 0 };
}
