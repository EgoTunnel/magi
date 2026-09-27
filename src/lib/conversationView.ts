import { getActivePath, getConversation, listMessages, type Conversation, type Message } from "@/lib/repo/conversations";
import { messagesWithAttachments } from "@/lib/repo/attachments";
import { annotateBranches, type BranchInfo } from "@/lib/conversationBranches";
import { listPendingCouncilRunsForConversation } from "@/lib/repo/councils";

// A conversation as its page shows it: the active branch, each message
// annotated with its siblings (if it's a branch point) and whether it carried
// attachments. Shared by GET /api/conversations/[id] and the conversation
// page's server render, so the first paint and every later refresh agree.
// A Council asked from this conversation that hasn't answered into it yet.
export interface PendingCouncil {
  id: string;
  question: string;
  mode: string;
  status: string;
}

export function loadConversationView(
  id: string
): { conversation: Conversation; messages: ConversationViewMessage[]; pendingCouncils: PendingCouncil[] } | null {
  const conversation = getConversation(id);
  if (!conversation) return null;

  const path = getActivePath(id);
  const branches = annotateBranches(listMessages(id), path);
  const withAttachments = messagesWithAttachments(id);
  const messages = path.map((m) => ({
    ...m,
    ...(branches.get(m.id) ?? {}),
    hasAttachments: m.role === "user" ? withAttachments.has(m.id) : undefined,
  }));
  const pendingCouncils = listPendingCouncilRunsForConversation(id).map((r) => ({
    id: r.id,
    question: r.question,
    mode: r.mode,
    status: r.status,
  }));
  return { conversation, messages, pendingCouncils };
}

export type ConversationViewMessage = Message & Partial<BranchInfo> & { hasAttachments?: boolean };
