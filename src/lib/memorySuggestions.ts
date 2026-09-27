// "Worth remembering?" — Magi noticing, turn by turn, when an exchange settled
// something durable, and offering to keep it.
//
// Memory in Magi is deliberate (Product Vision §20–21): nothing is ever kept
// without the user choosing to keep it. This doesn't change that. It only
// changes who notices: after each reply, Jev is asked one yes/no question
// about the exchange (fast and cheap enough to ask every turn). When it's
// fairly sure, the reply carries a suggestion, which the user can turn into a
// drafted one-line memory, edit, and keep, or dismiss. Without a TypeSafe key
// nothing is judged and nothing is suggested — the manual "Remember" actions
// work as they always have.
import { getModel, modelForRole, reasoningEffortForRole } from "@/lib/models/registry";
import { isJudgmentConfigured, judge, JUDGMENT_PROVIDER } from "@/lib/models/judgment";
import type { TokenUsage } from "@/lib/models/types";
import { recordUsage } from "@/lib/repo/usage";
import { getConversation, getMessage, setMessageProvenance } from "@/lib/repo/conversations";
import { createMemory, type MemoryItem } from "@/lib/repo/memory";

// Only fairly clear cases: a suggestion on every other reply would teach the
// user to ignore it.
export const MEMORY_SUGGEST_THRESHOLD = 0.7;
// The check runs between the reply finishing and the page being told it's
// saved. Jev answers in well under this; a slow call just means no suggestion
// this turn, never a slow turn.
const JUDGE_BUDGET_MS = 1500;
const TURN_CHARS = 3000;

export interface MemorySuggestion {
  probability: number;
  scope: "project" | "global";
  state: "open" | "accepted" | "dismissed";
  memoryId?: string;
}

// Returns a suggestion when Jev thinks the exchange is worth remembering, and
// null otherwise — including when Jev isn't configured, is slow, or fails.
export async function judgeMemoryWorth(input: {
  projectId: string;
  conversationId: string;
  userText: string;
  replyText: string;
}): Promise<MemorySuggestion | null> {
  if (!isJudgmentConfigured() || !input.userText.trim()) return null;
  try {
    const judged = judge({
      state: { user: input.userText.slice(0, TURN_CHARS), assistant: input.replyText.slice(0, TURN_CHARS) },
      questions: {
        worth: {
          type: "noul",
          instructions:
            "Does the user state or settle something durable in this exchange — a fact about themselves or their " +
            "work, a preference about how they want things done, or a decision — that would be useful to recall in " +
            "future conversations? General questions, general knowledge, and the assistant's own explanations or " +
            "suggestions don't count.",
        },
        scope: {
          type: "choice",
          instructions: "If it were remembered, where would it belong?",
          criteria: {
            project: "Specific to the piece of work this conversation is about",
            global: "About the user in general — true across all of their work",
          },
        },
      },
    });
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), JUDGE_BUDGET_MS));
    const result = await Promise.race([judged, timeout]);
    // A late answer still costs money; record it whenever it arrives.
    judged
      .then((r) =>
        recordUsage({
          projectId: input.projectId,
          source: "conversation",
          sourceId: input.conversationId,
          provider: JUDGMENT_PROVIDER,
          model: r.modelId,
          role: "memory_judge",
          usage: r.usage,
        })
      )
      .catch(() => {});
    if (!result) return null;
    const { probability } = result.answers.worth;
    if (probability < MEMORY_SUGGEST_THRESHOLD) return null;
    return { probability, scope: result.answers.scope.choice as "project" | "global", state: "open" };
  } catch (err) {
    console.error("[memory] Jev memory check failed", err instanceof Error ? err.message : err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Acting on a suggestion
// ---------------------------------------------------------------------------

const START = "<<<MEMORY>>>";
const END = "<<<END>>>";

// Only what's between the delimiters, so a model that thinks out loud first
// doesn't have its reasoning drafted into memory (see "Lessons learned" in
// docs/Handoff.md on the episode-close parser).
export function readDraft(reply: string): string {
  const start = reply.indexOf(START);
  let body = start === -1 ? reply : reply.slice(start + START.length);
  const end = body.indexOf(END);
  if (end !== -1) body = body.slice(0, end);
  return body.trim().replace(/^["“']|["”']$/g, "").trim();
}

function suggestionOf(messageId: string): { provenance: Record<string, unknown>; suggestion: MemorySuggestion } | null {
  const message = getMessage(messageId);
  if (!message?.provenance) return null;
  try {
    const provenance = JSON.parse(message.provenance) as Record<string, unknown>;
    const suggestion = provenance.memorySuggestion as MemorySuggestion | undefined;
    return suggestion ? { provenance, suggestion } : null;
  } catch {
    return null;
  }
}

function setSuggestion(messageId: string, patch: Partial<MemorySuggestion>) {
  const found = suggestionOf(messageId);
  if (!found) return;
  setMessageProvenance(messageId, { ...found.provenance, memorySuggestion: { ...found.suggestion, ...patch } });
}

// A one- or two-sentence memory drafted from the exchange, for the user to
// edit before keeping. The Fast model, since it's a short rewrite.
export async function draftMemory(messageId: string): Promise<{ content: string; scope: "project" | "global" }> {
  const reply = getMessage(messageId);
  if (!reply) throw new Error("Message not found");
  const asked = reply.parent_id ? getMessage(reply.parent_id) : null;
  const conversation = getConversation(reply.conversation_id);
  const modelId = modelForRole("fast");
  const resolved = getModel(modelId);
  if (!resolved || !resolved.provider.isConfigured()) throw new Error("No model is configured to draft with.");
  const usage: TokenUsage[] = [];
  const raw = await resolved.provider.complete({
    model: modelId,
    system:
      "You write entries for a person's long-term memory. From the exchange below, write the one thing worth " +
      "remembering as a single plain sentence (two at most), stated as a fact about the user or their work — for " +
      'example "Prefers …", "Decided …", "Is working on …". Only what the user said or settled — never the ' +
      `assistant's suggestions they didn't take up. No preamble, no commentary. Put the entry between ${START} and ${END}.`,
    messages: [
      {
        role: "user",
        content: `User:\n${(asked?.content ?? "").slice(0, TURN_CHARS)}\n\nAssistant:\n${reply.content.slice(0, TURN_CHARS)}`,
      },
    ],
    maxTokens: 1000,
    usage,
    reasoningEffort: reasoningEffortForRole("fast"),
  });
  recordUsage({
    projectId: conversation?.project_id,
    source: "conversation",
    sourceId: reply.conversation_id,
    provider: resolved.provider.id as "anthropic" | "openrouter" | "chutes",
    model: modelId,
    role: "memory_draft",
    usage,
  });
  const content = readDraft(raw);
  if (!content) throw new Error("The draft came back empty.");
  return { content, scope: suggestionOf(messageId)?.suggestion.scope ?? "project" };
}

// Keeping a suggestion is the deliberate act: it lands as established memory,
// linked back to the reply it came from, exactly like "Remember in Project".
export function acceptMemorySuggestion(messageId: string, content: string, scope: "project" | "global"): MemoryItem {
  const reply = getMessage(messageId);
  if (!reply) throw new Error("Message not found");
  const conversation = getConversation(reply.conversation_id);
  const item = createMemory({
    scope,
    projectId: scope === "project" ? conversation?.project_id : undefined,
    content,
    source: "conversation",
    sourceMessageId: messageId,
    sourceConversationId: reply.conversation_id,
  });
  setSuggestion(messageId, { state: "accepted", memoryId: item.id });
  return item;
}

export function dismissMemorySuggestion(messageId: string) {
  setSuggestion(messageId, { state: "dismissed" });
}
