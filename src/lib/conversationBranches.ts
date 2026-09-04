// View-layer computation over the message tree — sits beside
// conversationWindow.ts rather than inside repo/conversations.ts, which stays
// pure data access. Two jobs: telling the UI where the branch points are (so
// it can render "‹ i/N ›" and sibling previews), and resolving "jump to
// branch X" to the actual leaf that branch was taken to.
import type { Message } from "@/lib/repo/conversations";

export interface SiblingInfo {
  id: string;
  preview: string;
  created_at: string;
}

export interface BranchInfo {
  branchIndex: number;
  branchTotal: number;
  siblings: SiblingInfo[];
}

const PREVIEW_LENGTH = 100;

// Sibling order (and so which child counts as "most recent" in
// resolveHeadTarget) follows whatever order `messages` arrives in — callers
// pass listMessages()'s output, which is already created_at ASC with a
// rowid tiebreak for same-millisecond inserts (nowIso() has no monotonic
// counter), so grouping here just needs to preserve input order.
function groupByParent(messages: Message[]): Map<string | null, Message[]> {
  const groups = new Map<string | null, Message[]>();
  for (const m of messages) {
    const list = groups.get(m.parent_id) ?? [];
    list.push(m);
    groups.set(m.parent_id, list);
  }
  return groups;
}

function preview(content: string): string {
  const trimmed = content.trim();
  return trimmed.length > PREVIEW_LENGTH ? `${trimmed.slice(0, PREVIEW_LENGTH)}…` : trimmed;
}

// For every message on `path` whose sibling group has more than one member,
// attach branch metadata. Messages with no siblings get nothing, keeping the
// (overwhelmingly common) unbranched-conversation payload small.
export function annotateBranches(allMessages: Message[], path: Message[]): Map<string, BranchInfo> {
  const groups = groupByParent(allMessages);
  const info = new Map<string, BranchInfo>();
  for (const message of path) {
    const siblings = groups.get(message.parent_id) ?? [message];
    if (siblings.length <= 1) continue;
    info.set(message.id, {
      branchIndex: siblings.findIndex((s) => s.id === message.id),
      branchTotal: siblings.length,
      siblings: siblings.map((s) => ({ id: s.id, preview: preview(s.content), created_at: s.created_at })),
    });
  }
  return info;
}

// Resolves "switch to branch starting at messageId" to the leaf that branch
// was actually taken to — repeatedly following the most-recently-created
// child — so a click lands on however far that branch was continued, not a
// dead mid-tree node. Reduces to messageId itself when it has no children.
export function resolveHeadTarget(allMessages: Message[], messageId: string): string {
  const children = groupByParent(allMessages);
  let current = messageId;
  // Bounded by the conversation's own size — a defensive guard against a
  // corrupted/cyclic parent chain, not an expected case.
  for (let i = 0; i <= allMessages.length; i++) {
    const kids = children.get(current);
    if (!kids || kids.length === 0) return current;
    current = kids[kids.length - 1].id;
  }
  return current;
}
