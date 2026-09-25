// Hands a first message from the Home composer to the conversation it starts.
//
// Home creates the conversation and navigates to it; the conversation page
// sends the message the moment it mounts, so the reply streams in the
// conversation's own view (with Stop, branching, and the rest) rather than in
// a Home-page imitation of it. sessionStorage is the hand-off: same tab, gone
// with it, and never sent anywhere.
//
// Browser storage can be unavailable (a locked-down profile, a private
// window) — which is why stashPendingSend reports whether it worked, so the
// caller can fall back to opening the conversation with the text still in hand.
const key = (conversationId: string) => `magi:pending-send:${conversationId}`;

export interface PendingSend {
  content: string;
  modelRole?: string;
}

export function stashPendingSend(conversationId: string, pending: PendingSend): boolean {
  try {
    sessionStorage.setItem(key(conversationId), JSON.stringify(pending));
    return true;
  } catch {
    return false;
  }
}

// Read-once: a reload of the conversation must not send the message again.
export function takePendingSend(conversationId: string): PendingSend | null {
  try {
    const raw = sessionStorage.getItem(key(conversationId));
    if (!raw) return null;
    sessionStorage.removeItem(key(conversationId));
    const parsed = JSON.parse(raw) as PendingSend;
    return typeof parsed.content === "string" && parsed.content.trim() ? parsed : null;
  } catch {
    return null;
  }
}
