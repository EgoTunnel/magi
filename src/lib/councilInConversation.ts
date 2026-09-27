// "Ask the Council" from inside a conversation (Product Vision §41: "Magi
// Council: deliberate on this"). The conversation so far goes to the Council
// as material; when it has deliberated, the question and its conclusion are
// posted back into the thread — so the conversation carries on *from* the
// Council's answer, and later turns see it like any other exchange.
import { getActivePath, addMessage, getConversation, type Message } from "@/lib/repo/conversations";
import { getConversationSummary } from "@/lib/conversationWindow";
import {
  createCouncilRun,
  getCouncilRun,
  setCouncilRunResultMessage,
  type CouncilMode,
  type CouncilRole,
  type CouncilRun,
} from "@/lib/repo/councils";
import { runCouncilDeliberation } from "@/lib/council";
import { DEFAULT_COUNCIL_ROLES } from "@/lib/councilRoles";

// How much of the conversation the Council reads verbatim — its most recent
// part, with the rolling summary standing in for anything older.
const CONTEXT_CHARS = 24000;

export const CONVERSATION_COUNCIL_MODES = ["independent", "debate", "redTeam"] as const;
export type ConversationCouncilMode = (typeof CONVERSATION_COUNCIL_MODES)[number];

const MODE_LABEL: Record<CouncilMode, string> = {
  independent: "Independent Analysis",
  debate: "Debate",
  redTeam: "Red Team",
  matrix: "Decision Matrix",
};

// The conversation up to and including the message the Council was asked
// about — not past it: a branch the user has since moved on from, or turns
// written after asking, aren't what they asked about.
export function conversationContext(conversationId: string, uptoMessageId: string): string {
  const path = getActivePath(conversationId);
  const end = path.findIndex((m) => m.id === uptoMessageId);
  const upto = end === -1 ? path : path.slice(0, end + 1);
  const transcript = upto
    .map((m) => `${m.role === "user" ? "User" : "Magi"}: ${m.content}`)
    .join("\n\n");
  const recent = transcript.length > CONTEXT_CHARS ? `[…earlier turns omitted…]\n\n${transcript.slice(-CONTEXT_CHARS)}` : transcript;
  const { summary } = getConversationSummary(conversationId);
  return summary ? `Summary of the earlier conversation:\n${summary}\n\n---\n\n${recent}` : recent;
}

export function formatCouncilReply(run: CouncilRun): string {
  const consensus = run.consensus
    ? ` · Consensus: ${run.consensus}${run.consensus_detail?.source === "jev" ? " (measured)" : ""}`
    : "";
  const disagreement =
    run.disagreement && !/^none\b/i.test(run.disagreement.trim())
      ? `\n\n**Where the Council disagreed:** ${run.disagreement}`
      : "";
  return (
    `**Magi Council** · ${MODE_LABEL[run.mode]}${consensus}\n\n${run.synthesis ?? ""}${disagreement}\n\n` +
    `[Read the full deliberation](/councils/runs/${run.id})`
  );
}

// Posts a finished Council's answer into its conversation, once.
//
// Waits while a chat reply is in flight (the head is a user message whose
// answer hasn't been saved yet): appending now would put the Council's
// exchange between that message and its reply, and the reply — saved against
// its user message explicitly — would land on a side branch nobody is
// looking at. Gives up waiting after a few minutes and posts anyway, rather
// than never.
export async function postCouncilResult(
  runId: string,
  opts: { pollMs?: number; maxWaitMs?: number } = {}
): Promise<Message | null> {
  const pollMs = opts.pollMs ?? 2000;
  const maxWaitMs = opts.maxWaitMs ?? 3 * 60 * 1000;
  const run = getCouncilRun(runId);
  if (!run || !run.conversation_id || run.status !== "complete" || run.result_message_id) return null;
  const conversationId = run.conversation_id;

  const started = Date.now();
  for (;;) {
    const conversation = getConversation(conversationId);
    if (!conversation) return null;
    const head = conversation.head_message_id ? getActivePath(conversationId).at(-1) : null;
    if (head?.role !== "user" || Date.now() - started >= maxWaitMs) break;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }

  // Re-read: another caller may have posted it while this one waited.
  const current = getCouncilRun(runId);
  if (!current || current.result_message_id) return null;
  const asked = addMessage({
    conversationId,
    role: "user",
    content: `Asked the Magi Council (${MODE_LABEL[current.mode]}): ${current.question}`,
    provenance: { councilRunId: current.id, councilQuestion: true },
  });
  const reply = addMessage({
    conversationId,
    role: "assistant",
    content: formatCouncilReply(current),
    model: "magi-council",
    provenance: { councilRunId: current.id, mode: current.mode, consensus: current.consensus },
    parentId: asked.id,
  });
  setCouncilRunResultMessage(current.id, reply.id);
  return reply;
}

export function askCouncilFromConversation(input: {
  conversationId: string;
  messageId: string;
  question: string;
  mode: ConversationCouncilMode;
  roles?: CouncilRole[];
}): CouncilRun {
  const conversation = getConversation(input.conversationId);
  if (!conversation) throw new Error("Conversation not found");
  const attachments = [
    { filename: "The conversation so far", extractedText: conversationContext(input.conversationId, input.messageId) },
  ];
  const roles = input.roles ?? DEFAULT_COUNCIL_ROLES[input.mode];
  const run = createCouncilRun({
    projectId: conversation.project_id,
    question: input.question,
    mode: input.mode,
    attachments,
    conversationId: input.conversationId,
    sourceMessageId: input.messageId,
  });

  // Fire-and-forget, like the Councils page (see POST /api/councils/run):
  // the page polls the run and picks up the posted reply when it lands.
  // runCouncilDeliberation never rejects — it records failures on the run.
  void runCouncilDeliberation({
    runId: run.id,
    question: input.question,
    roles,
    projectId: conversation.project_id,
    mode: input.mode,
    attachments,
  })
    .then(() => postCouncilResult(run.id))
    .catch((err) => console.error("[council] couldn't post the Council's answer", err instanceof Error ? err.message : err));
  return run;
}
