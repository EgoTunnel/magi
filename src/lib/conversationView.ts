import { getActivePath, getConversation, listMessages, type Conversation, type Message } from "@/lib/repo/conversations";
import { messagesWithAttachments } from "@/lib/repo/attachments";
import { annotateBranches, type BranchInfo } from "@/lib/conversationBranches";

// A conversation as its page shows it: the active branch, each message
// annotated with its siblings (if it's a branch point) and whether it carried
// attachments. Shared by GET /api/conversations/[id] and the conversation
// page's server render, so the first paint and every later refresh agree.
export function loadConversationView(id: string): { conversation: Conversation; messages: ConversationViewMessage[] } | null {
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
  return { conversation, messages };
}

export type ConversationViewMessage = Message & Partial<BranchInfo> & { hasAttachments?: boolean };
