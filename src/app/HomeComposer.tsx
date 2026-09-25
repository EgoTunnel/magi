"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { IconSend } from "@/components/icons";
import { stashPendingSend } from "@/lib/pendingSend";
import { FOCUS_HOME_COMPOSER } from "@/lib/newConversation";

const LAST_PROJECT_KEY = "magi:home-project";

// Start a conversation straight from Home: choose a Project, type, send. It
// used to take Home → Project → "New conversation" → an empty conversation
// before there was anywhere to type. The conversation is created when the
// message is sent, not before, so an abandoned draft leaves no empty
// conversation behind.
export function HomeComposer({ projects }: { projects: Array<{ id: string; name: string }> }) {
  const router = useRouter();
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [draft, setDraft] = useState("");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // The Project you last started from, when it still exists — a per-browser
  // convenience only, so a blocked or empty storage just means the default.
  useEffect(() => {
    try {
      const last = localStorage.getItem(LAST_PROJECT_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- storage is only readable after mount
      if (last && projects.some((p) => p.id === last)) setProjectId(last);
    } catch {
      // storage unavailable: keep the default
    }
    inputRef.current?.focus();
  }, [projects]);

  // The new-conversation shortcut, pressed while already Home.
  useEffect(() => {
    const focus = () => inputRef.current?.focus();
    window.addEventListener(FOCUS_HOME_COMPOSER, focus);
    return () => window.removeEventListener(FOCUS_HOME_COMPOSER, focus);
  }, []);

  async function start() {
    const content = draft.trim();
    if (!content || !projectId || starting) return;
    setStarting(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/conversations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const data = await res.json();
      if (!res.ok || !data.conversation?.id) throw new Error(data.error ?? "Could not start a conversation.");
      if (!stashPendingSend(data.conversation.id, { content })) {
        throw new Error("This browser blocked the hand-off to the new conversation. Open it and send from there.");
      }
      try {
        localStorage.setItem(LAST_PROJECT_KEY, projectId);
      } catch {
        // a convenience; nothing to do
      }
      router.push(`/projects/${projectId}/c/${data.conversation.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start a conversation.");
      setStarting(false);
    }
  }

  return (
    <div className="mt-7 rounded-[4px] border border-[var(--color-border-strong)] bg-[var(--color-bg-raised)] p-3 transition-colors focus-within:border-[var(--color-accent)]">
      <textarea
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            start();
          }
        }}
        placeholder="What are you thinking about?"
        rows={2}
        disabled={starting}
        className="w-full resize-none [field-sizing:content] min-h-[3.25rem] max-h-60 bg-transparent px-1 py-1 text-[15px] text-[var(--color-text)] placeholder:text-[var(--color-text-faint)] outline-none"
      />
      <div className="mt-2 flex items-center justify-between gap-2">
        <label className="flex min-w-0 items-center gap-2 text-[11.5px] text-[var(--color-text-faint)] font-technical">
          <span className="uppercase tracking-[0.08em]">In</span>
          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="focus-ring min-w-0 max-w-[260px] truncate rounded-[3px] border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-[12px] text-[var(--color-text-muted)]"
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <Button variant="accent" onClick={start} disabled={!draft.trim() || starting} aria-label="Start conversation">
          <IconSend />
        </Button>
      </div>
      {error && <div className="mt-2 text-[12px] text-[var(--color-danger)]">{error}</div>}
    </div>
  );
}
