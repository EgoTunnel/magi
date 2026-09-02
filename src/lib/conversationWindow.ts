import { db, nowIso } from "@/lib/db";
import { getModel, modelForRole, reasoningEffortForRole } from "@/lib/models/registry";
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
  providerId: "anthropic" | "openrouter" | null;
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

  if (older.length === 0) {
    return {
      history: toModelMessages(usable),
      summary: null,
      summarizedCount: 0,
      windowCount: usable.length,
      usage: [],
      modelId: null,
      providerId: null,
    };
  }

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

  const modelId = modelForRole("fast");
  const resolved = getModel(modelId);
  if (!resolved || !resolved.provider.isConfigured()) {
    return {
      history: toModelMessages(usable),
      summary: null,
      summarizedCount: 0,
      windowCount: usable.length,
      usage: [],
      modelId: null,
      providerId: null,
    };
  }

  const priorBlock =
    coveredThrough >= 0 && state.summary ? `Summary of the conversation so far:\n\n${state.summary}\n\n---\n\n` : "";
  const newBlock = transcript(pending).slice(-FOLD_CHAR_BUDGET);

  const usage: TokenUsage[] = [];
  try {
    const summary = await resolved.provider.complete({
      model: modelId,
      system: SUMMARY_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `${priorBlock}New material to fold in:\n\n${newBlock}`,
        },
      ],
      maxTokens: SUMMARY_MAX_TOKENS,
      usage,
      reasoningEffort: reasoningEffortForRole("fast"),
    });
    const trimmed = summary.trim();
    if (!trimmed) throw new Error("Summarizer returned nothing");

    db.prepare(
      `UPDATE conversations
       SET summary = ?, summary_through_id = ?, summary_message_count = ?, summary_updated_at = ?
       WHERE id = ?`
    ).run(trimmed, older[older.length - 1].id, older.length, nowIso(), conversationId);

    return {
      history: toModelMessages(window),
      summary: trimmed,
      summarizedCount: older.length,
      windowCount: window.length,
      usage,
      modelId,
      providerId: resolved.provider.id as "anthropic" | "openrouter",
    };
  } catch (err) {
    console.error(
      `[conversationWindow] summary failed for ${conversationId}`,
      err instanceof Error ? err.message : err
    );
    return {
      history: toModelMessages(usable),
      summary: null,
      summarizedCount: 0,
      windowCount: usable.length,
      // The failed call may still have consumed tokens before erroring.
      usage,
      modelId,
      providerId: resolved.provider.id as "anthropic" | "openrouter",
    };
  }
}

export function getConversationSummary(conversationId: string): { summary: string | null; count: number } {
  const row = db
    .prepare(`SELECT summary, summary_message_count FROM conversations WHERE id = ?`)
    .get(conversationId) as { summary: string | null; summary_message_count: number } | undefined;
  return { summary: row?.summary ?? null, count: row?.summary_message_count ?? 0 };
}
