// "New conversation" from anywhere — the Ctrl/⌘+Shift+O shortcut and the
// command palette entry both land here. Inside a Project it opens a fresh
// conversation in that Project; anywhere else it goes to Home, whose composer
// starts one in whichever Project you pick.
type Router = { push: (href: string) => void };

export const FOCUS_HOME_COMPOSER = "magi:focus-home-composer";

export function projectIdFromPath(pathname: string): string | null {
  const match = /^\/projects\/([^/?#]+)/.exec(pathname);
  return match ? decodeURIComponent(match[1]) : null;
}

export function isNewConversationShortcut(e: KeyboardEvent): boolean {
  return (e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === "o";
}

export async function startNewConversation(router: Router, pathname: string): Promise<void> {
  const projectId = projectIdFromPath(pathname);
  if (!projectId) {
    // Already Home: pushing "/" again changes nothing, so ask the composer
    // there to take focus instead.
    if (pathname === "/") window.dispatchEvent(new Event(FOCUS_HOME_COMPOSER));
    else router.push("/");
    return;
  }
  const res = await fetch(`/api/projects/${projectId}/conversations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  const data = await res.json().catch(() => null);
  if (res.ok && data?.conversation?.id) router.push(`/projects/${projectId}/c/${data.conversation.id}`);
}
