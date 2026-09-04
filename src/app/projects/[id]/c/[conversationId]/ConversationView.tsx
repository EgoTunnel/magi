"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Input, Tag, Textarea } from "@/components/ui";
import { IconAttach, IconChevronDown, IconChevronRight, IconDocument, IconDownload, IconEdit, IconRefresh, IconSend, IconStop, IconTrash } from "@/components/icons";
import type { ContextProvenance } from "@/lib/contextBuilder";
import { renderMarkdown } from "@/lib/markdownToReact";
import { arrayBufferToBase64 } from "@/lib/clientFiles";
import { ArtifactViewerButton } from "@/components/ArtifactHistory";
import { MagiSpinner } from "@/components/MagiSpinner";
import { MoveConversationControl } from "@/components/MoveConversationControl";
import { EpisodeClosePanel, type ClosureDraft } from "@/components/EpisodeClosePanel";

interface Sibling {
  id: string;
  preview: string;
  created_at: string;
}
interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  model: string | null;
  provenance: string | null;
  created_at: string;
  parent_id: string | null;
  // Present only when this message has siblings (an edited or regenerated
  // branch point) — see annotateBranches() in src/lib/conversationBranches.ts.
  branchIndex?: number;
  branchTotal?: number;
  siblings?: Sibling[];
  hasAttachments?: boolean;
}
interface PersonOption {
  id: string;
  name: string;
  relationship: string | null;
}
interface Skill {
  id: string;
  name: string;
}
interface RoleInfo {
  id: string;
  label: string;
}
interface PendingAttachment {
  id: string;
  filename: string;
  kind: "image" | "text";
}
interface ArtifactFile {
  id: string;
  title: string;
  version: number;
  mime_type: string | null;
  message_id: string | null;
}

export function ConversationView({ projectId, conversationId }: { projectId: string; conversationId: string }) {
  const router = useRouter();
  const [projectName, setProjectName] = useState("");
  const [title, setTitle] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [skillId, setSkillId] = useState<string>("");
  const [roles, setRoles] = useState<RoleInfo[]>([]);
  const [modelRole, setModelRole] = useState("default");
  const [contextOpen, setContextOpen] = useState(false);
  const [savingArtifactFor, setSavingArtifactFor] = useState<string | null>(null);
  const [artifactTitleDraft, setArtifactTitleDraft] = useState("");
  const [people, setPeople] = useState<PersonOption[]>([]);
  const [rememberPersonFor, setRememberPersonFor] = useState<string | null>(null);
  const [rememberPersonId, setRememberPersonId] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [artifactFiles, setArtifactFiles] = useState<ArtifactFile[]>([]);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [closureDraft, setClosureDraft] = useState<ClosureDraft | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);
  // Set when this page was opened by a link to a specific message — from the
  // Context panel's retrieved passages, or from a memory item's source.
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [expandedBranchFor, setExpandedBranchFor] = useState<string | null>(null);
  const [switchingBranch, setSwitchingBranch] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastMessageRef = useRef<HTMLDivElement>(null);
  const attachFileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  // The live reply's text does NOT live in this component's state. It arrives a
  // token at a time, and holding it here re-rendered every message in the
  // conversation on every token — each assistant message re-parsing its own
  // markdown — so a long reply got visibly slower the longer it got. It lives
  // in <StreamingMessage> instead, driven imperatively through this handle, and
  // nothing above it re-renders while a reply streams.
  const streamRef = useRef<StreamHandle>(null);
  // Landing scroll (jump straight to the latest messages) fires once per
  // conversation visit; every load() after that (post-turn refresh) must NOT
  // re-trigger it, or it'd yank the view back down right as a long response
  // that was deliberately left pinned near the top finishes streaming.
  const initialScrollDoneRef = useRef(false);

  async function load() {
    const [convRes, skillsRes, modelsRes, artifactsRes, peopleRes] = await Promise.all([
      fetch(`/api/conversations/${conversationId}`),
      fetch(`/api/skills?projectId=${projectId}`),
      fetch(`/api/models`),
      fetch(`/api/artifacts?conversationId=${conversationId}`),
      fetch(`/api/people?status=established`),
    ]);
    const convData = await convRes.json();
    setTitle(convData.conversation?.title ?? "");
    setMessages(convData.messages ?? []);
    setSkills((await skillsRes.json()).skills ?? []);
    setRoles((await modelsRes.json()).roles ?? []);
    setArtifactFiles((await artifactsRes.json()).artifacts ?? []);
    setPeople((await peopleRes.json()).people ?? []);

    const projRes = await fetch(`/api/projects/${projectId}`);
    const projData = await projRes.json();
    setProjectName(projData.project?.name ?? "");
  }

  // Branch-switching, editing, and regenerating never change
  // skills/models/people/the Project — refetching those on every click (what
  // load() does) would make stepping through sibling answers to compare them
  // needlessly slow. Artifacts still need a refresh: an edited or
  // regenerated turn can produce a new one via tool use, same as a normal
  // send.
  async function reloadMessages() {
    const [convRes, artifactsRes] = await Promise.all([
      fetch(`/api/conversations/${conversationId}`),
      fetch(`/api/artifacts?conversationId=${conversationId}`),
    ]);
    const data = await convRes.json();
    setTitle(data.conversation?.title ?? "");
    setMessages(data.messages ?? []);
    setArtifactFiles((await artifactsRes.json()).artifacts ?? []);
  }

  // An existing draft is fetched, never re-drafted: reopening a conversation
  // must not silently spend on a fresh pass over it.
  async function loadClosure() {
    const res = await fetch(`/api/conversations/${conversationId}/close`);
    setClosureDraft((await res.json()).draft ?? null);
  }

  async function draftClosure() {
    setDrafting(true);
    setCloseError(null);
    const res = await fetch(`/api/conversations/${conversationId}/close`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) setCloseError(data.message ?? data.error ?? "Could not close this episode.");
    else setClosureDraft(data.draft);
    setDrafting(false);
  }

  async function openClose() {
    setCloseOpen(true);
    await loadClosure();
  }

  useEffect(() => {
    initialScrollDoneRef.current = false;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  // Landing on a conversation: jump straight to its latest messages, once —
  // unless the URL names a specific message, in which case go there instead
  // and mark it, so a link from the Context panel or a memory item's source
  // lands on the thing it was pointing at rather than on the tail.
  useEffect(() => {
    if (initialScrollDoneRef.current || messages.length === 0 || !scrollRef.current) return;
    const target = window.location.hash.slice(1);
    if (target && messages.some((m) => m.id === target)) {
      document.getElementById(target)?.scrollIntoView({ block: "center" });
      setHighlightedMessageId(target);
    } else {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight });
    }
    initialScrollDoneRef.current = true;
  }, [messages]);

  // A new turn starting: scroll so the message that was just sent lands at
  // the top of the viewport, the same way Claude.ai/ChatGPT do — the reply
  // then fills in below it as it streams, rather than the view chasing the
  // growing tail of text down the page on every token (the old behavior,
  // and the thing that made long replies annoying to read from the start).
  useEffect(() => {
    if (sending) {
      lastMessageRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [sending]);

  // "Jump to latest" only shows once there's actually somewhere to jump to —
  // recomputed both on manual scroll and as streamed content grows the page
  // out from under a scroll position that used to be at the bottom. Stable
  // across renders so the streaming block can call it as it grows without
  // dragging this component into a re-render per token: setState with an
  // unchanged boolean is a no-op, so this only costs anything when the answer
  // actually flips.
  const recomputeJumpToLatest = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setShowJumpToLatest(el.scrollHeight - el.scrollTop - el.clientHeight > 160);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    recomputeJumpToLatest();
    el.addEventListener("scroll", recomputeJumpToLatest);
    return () => el.removeEventListener("scroll", recomputeJumpToLatest);
  }, [messages, recomputeJumpToLatest]);

  function scrollToLatest() {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }

  async function handleAttachFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploadingAttachment(true);
    setAttachmentError(null);
    try {
      const dataBase64 = arrayBufferToBase64(await file.arrayBuffer());
      const res = await fetch(`/api/conversations/${conversationId}/attachments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, mimeType: file.type, dataBase64 }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAttachmentError(data.error ?? "Could not attach that file.");
        return;
      }
      setPendingAttachments((a) => [...a, data.attachment]);
    } finally {
      setUploadingAttachment(false);
    }
  }

  async function removePendingAttachment(id: string) {
    setPendingAttachments((a) => a.filter((att) => att.id !== id));
    await fetch(`/api/attachments/${id}`, { method: "DELETE" });
  }

  // Reads one chat/regenerate NDJSON stream, updating the live "typing"
  // preview as chunks arrive. Persistence already happened server-side by
  // the time this returns (or throws) — the caller reloads from the API
  // afterward rather than trusting anything accumulated here.
  async function streamChatResponse(res: Response) {
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let full = "";
    let buffer = "";
    const handleLine = (line: string) => {
      if (!line.trim()) return;
      let event: { type: string; text?: string; name?: string };
      try {
        event = JSON.parse(line);
      } catch {
        return;
      }
      if (event.type === "text" && event.text) {
        full += event.text;
        // Always the whole accumulated reply, never a delta — so a call that
        // lands before the streaming block has mounted costs nothing beyond
        // itself; the next token carries everything anyway.
        streamRef.current?.setText(full);
      } else if (event.type === "tool_start" && event.name) {
        streamRef.current?.setTool(event.name);
      } else if (event.type === "tool_end") {
        streamRef.current?.setTool(null);
      }
    };
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) handleLine(line);
    }
    if (buffer) handleLine(buffer);
  }

  async function send() {
    const content = draft.trim();
    if ((!content && pendingAttachments.length === 0) || sending) return;
    const attachmentIds = pendingAttachments.map((a) => a.id);
    setDraft("");
    setPendingAttachments([]);
    setSending(true);
    setError(null);
    setMessages((m) => [
      ...m,
      { id: `local-${Date.now()}`, role: "user", content, model: null, provenance: null, created_at: new Date().toISOString(), parent_id: null },
    ]);
    streamRef.current?.reset();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(`/api/conversations/${conversationId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, skillId: skillId || undefined, modelRole, attachmentIds }),
        signal: controller.signal,
      });

      if (res.status === 412) {
        const data = await res.json();
        setError(data.message ?? "No API key configured.");
        return;
      }
      if (!res.ok || !res.body) {
        setError("Something went wrong reaching the model.");
        return;
      }
      await streamChatResponse(res);
    } catch (err) {
      // The user pressed Stop — the partial reply Magi already streamed was
      // persisted server-side (see chatTurn.ts), so this isn't an error.
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        setError("Connection interrupted.");
      }
    } finally {
      streamRef.current?.reset();
      setSending(false);
      abortRef.current = null;
      // Not load(): a turn can't change the Project's skills, the model roles,
      // or the people roster, so refetching those five endpoints only delayed
      // the finished reply appearing.
      await reloadMessages();
    }
  }

  function stop() {
    abortRef.current?.abort();
  }

  // messageId defaults to the last message (today's simple "Regenerate"
  // button); an explicit id — passed when the button is clicked on an
  // earlier reply — regenerates that one instead, branching from there.
  async function regenerate(messageId?: string) {
    if (sending) return;
    const targetId = messageId ?? messages[messages.length - 1]?.id;
    const index = messages.findIndex((m) => m.id === targetId);
    if (index === -1 || messages[index].role !== "assistant") return;
    // Truncate to right before the reply being replaced — otherwise, once
    // this can target an earlier message, the live streaming block would
    // render below later messages that are about to disappear.
    setMessages((m) => m.slice(0, index));
    setSending(true);
    setError(null);
    streamRef.current?.reset();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(`/api/conversations/${conversationId}/chat/regenerate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId: targetId, skillId: skillId || undefined, modelRole }),
        signal: controller.signal,
      });
      if (res.status === 412) {
        const data = await res.json();
        setError(data.message ?? "No API key configured.");
        return;
      }
      if (!res.ok || !res.body) {
        setError("Something went wrong reaching the model.");
        return;
      }
      await streamChatResponse(res);
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        setError("Connection interrupted.");
      }
    } finally {
      streamRef.current?.reset();
      setSending(false);
      abortRef.current = null;
      await reloadMessages();
    }
  }

  function startEdit(messageId: string, content: string) {
    setEditingMessageId(messageId);
    setEditDraft(content);
  }

  function cancelEdit() {
    setEditingMessageId(null);
    setEditDraft("");
  }

  async function saveEdit() {
    const messageId = editingMessageId;
    const content = editDraft.trim();
    if (!messageId || !content || sending) return;
    const index = messages.findIndex((m) => m.id === messageId);
    if (index === -1) return;
    setEditingMessageId(null);
    setSending(true);
    setError(null);
    // Show the edited text immediately and drop everything after it — that's
    // the new branch's tip until the reply streams in, so the live block
    // lands right after it instead of after messages about to disappear.
    setMessages((m) => [
      ...m.slice(0, index),
      { ...m[index], content, branchIndex: undefined, branchTotal: undefined, siblings: undefined },
    ]);
    streamRef.current?.reset();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(`/api/conversations/${conversationId}/messages/${messageId}/edit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, skillId: skillId || undefined, modelRole }),
        signal: controller.signal,
      });
      if (res.status === 412) {
        const data = await res.json();
        setError(data.message ?? "No API key configured.");
        return;
      }
      if (!res.ok || !res.body) {
        setError("Something went wrong reaching the model.");
        return;
      }
      await streamChatResponse(res);
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        setError("Connection interrupted.");
      }
    } finally {
      streamRef.current?.reset();
      setSending(false);
      abortRef.current = null;
      await reloadMessages();
    }
  }

  async function switchBranch(messageId: string) {
    if (sending || switchingBranch) return;
    setSwitchingBranch(true);
    await fetch(`/api/conversations/${conversationId}/branch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageId }),
    });
    setExpandedBranchFor(null);
    await reloadMessages();
    setSwitchingBranch(false);
  }

  // Branch pills are only visible once you've scrolled to the exact message
  // that has one — this is what makes branch points discoverable without
  // reading the whole conversation top to bottom.
  const branchPointIds = useMemo(
    () => messages.filter((m) => (m.branchTotal ?? 1) > 1).map((m) => m.id),
    [messages]
  );

  // Grouped once rather than re-filtered per message: the list render was
  // walking the whole artifact list once for every message in the
  // conversation, which is quadratic in a Project that generates a lot of them.
  const artifactsByMessage = useMemo(() => {
    const map = new Map<string, ArtifactFile[]>();
    for (const file of artifactFiles) {
      if (!file.message_id) continue;
      const list = map.get(file.message_id);
      if (list) list.push(file);
      else map.set(file.message_id, [file]);
    }
    return map;
  }, [artifactFiles]);

  function jumpToNextBranchPoint() {
    const container = scrollRef.current;
    if (!container || branchPointIds.length === 0) return;
    const containerTop = container.getBoundingClientRect().top;
    const positioned = branchPointIds
      .map((id) => {
        const el = document.getElementById(id);
        return el ? { id, top: el.getBoundingClientRect().top - containerTop } : null;
      })
      .filter((p): p is { id: string; top: number } => !!p)
      .sort((a, b) => a.top - b.top);
    const next = positioned.find((p) => p.top > 20) ?? positioned[0];
    if (!next) return;
    document.getElementById(next.id)?.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightedMessageId(next.id);
  }

  async function rememberMessage(content: string, scope: "global" | "project", messageId: string) {
    await fetch("/api/memory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scope,
        projectId: scope === "project" ? projectId : undefined,
        content,
        source: "conversation",
        // Claim-level provenance: the exact message this was promoted from, so
        // the Memory page can link straight back to it.
        sourceMessageId: messageId,
        sourceConversationId: conversationId,
      }),
    });
  }

  function startRememberPerson(messageId: string) {
    setRememberPersonFor(messageId);
    setRememberPersonId("");
  }

  async function confirmRememberPerson(content: string) {
    if (!rememberPersonId || !rememberPersonFor) return;
    await fetch(`/api/people/${rememberPersonId}/facts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content,
        source: "conversation",
        // The whole reason this action exists — the fact keeps the message it
        // came from, so the person's page can link back to it.
        sourceMessageId: rememberPersonFor,
        sourceConversationId: conversationId,
      }),
    });
    setRememberPersonFor(null);
    setRememberPersonId("");
  }

  function startSaveArtifact(messageId: string) {
    setSavingArtifactFor(messageId);
    setArtifactTitleDraft(title || "Untitled artifact");
  }

  function cancelSaveArtifact() {
    setSavingArtifactFor(null);
    setArtifactTitleDraft("");
  }

  async function confirmSaveArtifact(content: string) {
    const artifactTitle = artifactTitleDraft.trim();
    if (!artifactTitle) return;
    await fetch("/api/artifacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, conversationId, messageId: savingArtifactFor, title: artifactTitle, content }),
    });
    setSavingArtifactFor(null);
    setArtifactTitleDraft("");
    await load();
  }

  // Parsed once per message list rather than on every render: a turn's
  // provenance carries every retrieved passage, so this is a real parse, not a
  // trivial one.
  const provenance: ContextProvenance | null = useMemo(() => {
    const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
    if (!lastAssistant?.provenance) return null;
    try {
      return JSON.parse(lastAssistant.provenance) as ContextProvenance;
    } catch {
      return null;
    }
  }, [messages]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-6 py-3">
        <div className="flex min-w-0 items-center gap-1.5 text-[12.5px] text-[var(--color-text-faint)]">
          <Link href={`/projects/${projectId}`} className="hover:text-[var(--color-text)] transition-colors truncate max-w-[160px]">
            {projectName}
          </Link>
          <IconChevronRight />
          <span className="truncate text-[var(--color-text-muted)]">{title}</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <MoveConversationControl
            conversationId={conversationId}
            currentProjectId={projectId}
            onMoved={(newProjectId) => router.push(`/projects/${newProjectId}/c/${conversationId}`)}
          />
          {branchPointIds.length > 0 && (
            <button
              onClick={jumpToNextBranchPoint}
              className="focus-ring rounded-[3px] border border-[var(--color-border)] px-2 py-1 text-[11px] uppercase tracking-[0.08em] text-[var(--color-text-faint)] font-technical hover:text-[var(--color-text)] transition-colors"
              title="Jump to the next branch point"
            >
              {branchPointIds.length} branch point{branchPointIds.length === 1 ? "" : "s"}
            </button>
          )}
          <button
            onClick={() => (closeOpen ? setCloseOpen(false) : openClose())}
            disabled={messages.length === 0}
            className="focus-ring rounded-[3px] border border-[var(--color-border)] px-2 py-1 text-[11px] uppercase tracking-[0.08em] text-[var(--color-text-faint)] font-technical hover:text-[var(--color-text)] transition-colors disabled:opacity-40"
          >
            Close episode
          </button>
          <button
            onClick={() => setContextOpen((v) => !v)}
            className="focus-ring rounded-[3px] border border-[var(--color-border)] px-2 py-1 text-[11px] uppercase tracking-[0.08em] text-[var(--color-text-faint)] font-technical hover:text-[var(--color-text)] transition-colors"
          >
            Context
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div className="relative flex-1 overflow-hidden">
          <div ref={scrollRef} className="h-full overflow-y-auto px-6 py-6">
            <div className="mx-auto flex max-w-2xl flex-col gap-7">
              {messages.length === 0 && !sending && (
                <p className="text-[13px] text-[var(--color-text-faint)]">
                  This conversation is empty. Say something to begin.
                </p>
              )}
              {messages.map((m, i) => (
                <div
                  key={m.id}
                  id={m.id}
                  ref={i === messages.length - 1 ? lastMessageRef : undefined}
                  // The scroll-margin keeps a message linked to by fragment
                  // from landing flush against the top edge of the pane.
                  className={`scroll-mt-6 ${
                    highlightedMessageId === m.id
                      ? "-mx-3 rounded-[4px] border-l-2 border-[var(--color-accent)] bg-[var(--color-surface)] px-3 py-2"
                      : ""
                  }`}
                >
                  <MessageBlock
                    message={m}
                    files={artifactsByMessage.get(m.id)}
                    onRemember={rememberMessage}
                    onStartSaveArtifact={startSaveArtifact}
                    savingArtifact={savingArtifactFor === m.id}
                    artifactTitleDraft={artifactTitleDraft}
                    onArtifactTitleChange={setArtifactTitleDraft}
                    onConfirmSaveArtifact={confirmSaveArtifact}
                    onCancelSaveArtifact={cancelSaveArtifact}
                    onArtifactRestored={load}
                    people={people}
                    rememberingPerson={rememberPersonFor === m.id}
                    rememberPersonId={rememberPersonId}
                    onStartRememberPerson={startRememberPerson}
                    onRememberPersonChange={setRememberPersonId}
                    onConfirmRememberPerson={confirmRememberPerson}
                    onCancelRememberPerson={() => setRememberPersonFor(null)}
                    onRegenerate={() => regenerate(m.id)}
                    sending={sending}
                    isEditing={editingMessageId === m.id}
                    editDraft={editDraft}
                    onEditDraftChange={setEditDraft}
                    onStartEdit={() => startEdit(m.id, m.content)}
                    onSaveEdit={saveEdit}
                    onCancelEdit={cancelEdit}
                    branchExpanded={expandedBranchFor === m.id}
                    onToggleBranchPanel={() => setExpandedBranchFor((cur) => (cur === m.id ? null : m.id))}
                    onSwitchBranch={switchBranch}
                    switchingBranch={switchingBranch}
                  />
                </div>
              ))}
              {sending && <StreamingMessage ref={streamRef} onGrow={recomputeJumpToLatest} />}
              {error && (
                <div className="rounded-[4px] border border-[var(--color-accent)] bg-[var(--color-surface)] px-4 py-3 text-[13px] text-[var(--color-text)]">
                  {error}{" "}
                  {error.includes("Settings") || error.includes("API key") ? (
                    <Link href="/settings" className="text-[var(--color-accent)] underline">
                      Open Settings
                    </Link>
                  ) : null}
                </div>
              )}
              {closeOpen && (
                <EpisodeClosePanel
                  draft={closureDraft}
                  projectId={projectId}
                  drafting={drafting}
                  error={closeError}
                  onDraft={draftClosure}
                  onChanged={loadClosure}
                  onDismiss={() => setCloseOpen(false)}
                />
              )}
            </div>
          </div>

          {showJumpToLatest && (
            <button
              onClick={scrollToLatest}
              className="focus-ring absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-[var(--color-border-strong)] bg-[var(--color-bg-raised)] px-3.5 py-1.5 text-[12px] text-[var(--color-text)] shadow-md transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
            >
              Jump to latest <IconChevronDown />
            </button>
          )}
        </div>

        {contextOpen && (
          <div className="w-72 shrink-0 overflow-y-auto border-l border-[var(--color-border)] px-4 py-5">
            <div className="mb-3 text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--color-text-faint)] font-technical">
              Context
            </div>
            {provenance ? (
              <div className="flex flex-col gap-3 text-[12.5px] text-[var(--color-text-muted)]">
                <div>
                  <div className="text-[var(--color-text-faint)]">Project</div>
                  <div className="text-[var(--color-text)]">{provenance.projectName}</div>
                </div>
                {provenance.ancestorProjects.length > 0 && (
                  <div>
                    <div className="mb-1 text-[var(--color-text-faint)]">Inherits from</div>
                    <div className="text-[var(--color-text)]">
                      {provenance.ancestorProjects.map((a) => a.name).join(" → ")}
                    </div>
                  </div>
                )}
                <div>{provenance.usedInstructions ? "Project instructions applied" : "No Project instructions set"}</div>
                <div>{provenance.usedBrandGuide ? "Brand Guide applied" : "No Brand Guide set"}</div>
                <div>{provenance.globalMemoryCount} global memory item(s)</div>
                <div>{provenance.projectMemoryCount} Project memory item(s)</div>
                {provenance.peopleOnProject > 0 && (
                  <div>
                    {provenance.peopleOnProject} person/people named on this Project (names only — facts come from
                    lookup_person)
                  </div>
                )}
                {provenance.summarizedMessages ? (
                  <div>
                    <div className="text-[var(--color-text-faint)]">Conversation history</div>
                    <div>
                      Earliest {provenance.summarizedMessages} message(s) sent as a rolling summary; the rest
                      verbatim.
                    </div>
                  </div>
                ) : null}
                {provenance.retrieved && provenance.retrieved.length > 0 && (
                  <div>
                    <div className="mb-1 text-[var(--color-text-faint)]">
                      Retrieved for this message ({provenance.retrieved.length})
                    </div>
                    <ul className="flex flex-col gap-2">
                      {provenance.retrieved.map((p, i) => (
                        <li key={p.chunkId}>
                          <div className="text-[var(--color-text)]">
                            <span className="font-technical text-[11px] text-[var(--color-text-faint)]">[P{i + 1}]</span>{" "}
                            {p.href ? (
                              <Link
                                href={p.href}
                                className="underline decoration-[var(--color-border-strong)] underline-offset-2 transition-colors hover:text-[var(--color-accent)] hover:decoration-[var(--color-accent)]"
                              >
                                {p.title}
                              </Link>
                            ) : (
                              p.title
                            )}
                          </div>
                          <div className="font-technical text-[10.5px] uppercase tracking-[0.08em] text-[var(--color-text-faint)]">
                            {p.kind.replace("_", " ")} · {p.sourceDate.slice(0, 10)} · {p.matchedBy}
                            {p.similarity !== undefined ? ` · ${p.similarity.toFixed(2)}` : ""}
                            {p.fromAnotherProject ? " · related Project" : ""}
                          </div>
                          {p.sourceContext && (
                            <div className="text-[11px] text-[var(--color-text-faint)]">in {p.sourceContext}</div>
                          )}
                          <div className="mt-0.5 text-[11.5px] leading-snug text-[var(--color-text-faint)]">
                            {p.preview}…
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {provenance.documentsUsed.length > 0 && (
                  <div>
                    <div className="mb-1 text-[var(--color-text-faint)]">
                      Documents <span className="text-[11px]">(in list order — nothing indexed to retrieve from yet)</span>
                    </div>
                    <ul className="flex flex-col gap-1">
                      {provenance.documentsUsed.map((d) => (
                        <li key={d.id}>
                          {d.title} {d.truncated && <span className="text-[var(--color-text-faint)]">(truncated)</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {provenance.skillUsed && <div>Skill: {provenance.skillUsed.name}</div>}
                {provenance.autoSelectedRole && (
                  <div>
                    Auto-selected: {roles.find((r) => r.id === provenance.autoSelectedRole)?.label ?? provenance.autoSelectedRole}
                  </div>
                )}
                {provenance.usage && (
                  <div>
                    <div className="text-[var(--color-text-faint)]">Usage (this turn)</div>
                    <div className="font-technical text-[11.5px]">
                      {(provenance.usage.promptTokens + provenance.usage.completionTokens).toLocaleString()} tokens
                      {provenance.usage.costUsd !== null ? ` · $${provenance.usage.costUsd.toFixed(4)}` : ""}
                    </div>
                  </div>
                )}
                {provenance.toolCalls && provenance.toolCalls.length > 0 && (
                  <div>
                    <div className="mb-1 text-[var(--color-text-faint)]">Tools used</div>
                    <ul className="flex flex-col gap-1">
                      {provenance.toolCalls.map((t, i) => (
                        <li key={i} className="font-technical text-[11.5px]">
                          {t.name}
                          {t.name === "search_archive" && typeof t.input === "object" && t.input && "query" in t.input
                            ? ` — "${(t.input as { query: string }).query}"`
                            : ""}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-[12.5px] text-[var(--color-text-faint)]">Send a message to see what Magi drew on.</p>
            )}
          </div>
        )}
      </div>

      <div className="border-t border-[var(--color-border)] px-6 py-3.5">
        <div className="mx-auto flex max-w-2xl flex-col gap-2">
          <div className="flex items-center gap-2">
            <select
              value={skillId}
              onChange={(e) => setSkillId(e.target.value)}
              className="focus-ring rounded-[3px] border border-[var(--color-border)] bg-[var(--color-bg-raised)] px-2 py-1 text-[11.5px] text-[var(--color-text-muted)]"
            >
              <option value="">No Skill</option>
              {skills.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <select
              value={modelRole}
              onChange={(e) => setModelRole(e.target.value)}
              className="focus-ring rounded-[3px] border border-[var(--color-border)] bg-[var(--color-bg-raised)] px-2 py-1 text-[11.5px] text-[var(--color-text-muted)]"
            >
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
              <option value="auto">Auto — let Magi choose</option>
            </select>
          </div>
          {attachmentError && (
            <div className="rounded-[4px] border border-[var(--color-danger)] px-3 py-1.5 text-[12px] text-[var(--color-danger)]">
              {attachmentError}
            </div>
          )}
          {pendingAttachments.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {pendingAttachments.map((a) => (
                <span
                  key={a.id}
                  className="flex items-center gap-1.5 rounded-[3px] border border-[var(--color-border-strong)] bg-[var(--color-bg-raised)] px-2 py-1 text-[11.5px] text-[var(--color-text-muted)]"
                >
                  {a.filename}
                  <button
                    onClick={() => removePendingAttachment(a.id)}
                    className="focus-ring text-[var(--color-text-faint)] hover:text-[var(--color-danger)]"
                    aria-label={`Remove ${a.filename}`}
                  >
                    <IconTrash />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="flex items-end gap-2">
            <input
              ref={attachFileInputRef}
              type="file"
              accept=".pdf,.docx,.pptx,.txt,.md,.csv,.json,image/png,image/jpeg,image/webp,image/gif"
              className="hidden"
              onChange={handleAttachFile}
            />
            <Button variant="ghost" onClick={() => attachFileInputRef.current?.click()} disabled={uploadingAttachment}>
              <IconAttach />
            </Button>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder="Say something to Magi…"
              rows={2}
              className="focus-ring w-full resize-none rounded-[4px] border border-[var(--color-border-strong)] bg-[var(--color-bg)] px-3 py-2 text-[14px] text-[var(--color-text)] placeholder:text-[var(--color-text-faint)]"
            />
            {sending ? (
              <Button variant="danger" onClick={stop} aria-label="Stop generating" title="Stop generating">
                <IconStop />
              </Button>
            ) : (
              <Button variant="accent" onClick={send} disabled={!draft.trim() && pendingAttachments.length === 0}>
                <IconSend />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// The live reply, and the only thing on the page that re-renders while one is
// streaming. It owns its own text so that arriving tokens never touch
// ConversationView's state — see streamRef there. The handle is imperative for
// the same reason: a prop would put the text back in the parent.
export interface StreamHandle {
  setText: (text: string) => void;
  setTool: (name: string | null) => void;
  reset: () => void;
}

const StreamingMessage = forwardRef<StreamHandle, { onGrow?: () => void }>(function StreamingMessage(
  { onGrow },
  ref
) {
  const [text, setText] = useState("");
  const [tool, setTool] = useState<string | null>(null);

  useImperativeHandle(
    ref,
    () => ({
      setText,
      setTool,
      reset: () => {
        setText("");
        setTool(null);
      },
    }),
    []
  );

  // Growing text pushes the page out from under a scroll position that used to
  // be at the bottom, so "jump to latest" has to be reconsidered as it arrives.
  useEffect(() => {
    onGrow?.();
  }, [text, onGrow]);

  return (
    <div className="group">
      <div className="mb-1.5 flex items-center gap-2">
        <span className="text-[10.5px] font-medium uppercase tracking-[0.1em] text-[var(--color-text-faint)] font-technical">
          Magi
        </span>
        <span className="flex items-center gap-1.5 text-[10.5px] text-[var(--color-accent)] font-technical">
          <MagiSpinner />
          {tool ? `using ${tool}…` : text ? "writing…" : "thinking…"}
        </span>
      </div>
      {/* Deliberately not parsed as markdown and deliberately not split into
          per-line elements: both cost the whole reply's length on every token,
          which is what made a long answer slow down as it wrote itself. The
          finished message re-renders as real markdown a moment later. */}
      <div className="prose-magi">
        <p className="whitespace-pre-wrap">{text}</p>
      </div>
    </div>
  );
});

function MessageBlock({
  message,
  files,
  onRemember,
  onStartSaveArtifact,
  savingArtifact,
  artifactTitleDraft,
  onArtifactTitleChange,
  onConfirmSaveArtifact,
  onCancelSaveArtifact,
  onArtifactRestored,
  onRegenerate,
  sending,
  people,
  rememberingPerson,
  rememberPersonId,
  onStartRememberPerson,
  onRememberPersonChange,
  onConfirmRememberPerson,
  onCancelRememberPerson,
  isEditing,
  editDraft,
  onEditDraftChange,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  branchExpanded,
  onToggleBranchPanel,
  onSwitchBranch,
  switchingBranch,
}: {
  message: Message;
  files?: ArtifactFile[];
  onRemember?: (content: string, scope: "global" | "project", messageId: string) => void;
  onStartSaveArtifact?: (messageId: string) => void;
  savingArtifact?: boolean;
  artifactTitleDraft?: string;
  onArtifactTitleChange?: (title: string) => void;
  onConfirmSaveArtifact?: (content: string) => void;
  onCancelSaveArtifact?: () => void;
  onArtifactRestored?: () => void;
  onRegenerate?: () => void;
  sending?: boolean;
  people?: PersonOption[];
  rememberingPerson?: boolean;
  rememberPersonId?: string;
  onStartRememberPerson?: (messageId: string) => void;
  onRememberPersonChange?: (id: string) => void;
  onConfirmRememberPerson?: (content: string) => void;
  onCancelRememberPerson?: () => void;
  isEditing?: boolean;
  editDraft?: string;
  onEditDraftChange?: (content: string) => void;
  onStartEdit?: () => void;
  onSaveEdit?: () => void;
  onCancelEdit?: () => void;
  branchExpanded?: boolean;
  onToggleBranchPanel?: () => void;
  onSwitchBranch?: (messageId: string) => void;
  switchingBranch?: boolean;
}) {
  const isUser = message.role === "user";
  const branchTotal = message.branchTotal ?? 1;
  const branchIndex = message.branchIndex ?? 0;
  const siblings = message.siblings ?? [];
  const stepBranch = (delta: number) => {
    if (!siblings.length || !onSwitchBranch) return;
    const target = siblings[(branchIndex + delta + siblings.length) % siblings.length];
    onSwitchBranch(target.id);
  };
  return (
    <div className="group">
      <div className="mb-1.5 flex items-center gap-2">
        <span className="text-[10.5px] font-medium uppercase tracking-[0.1em] text-[var(--color-text-faint)] font-technical">
          {isUser ? "You" : "Magi"}
        </span>
        {message.model && <Tag>{message.model}</Tag>}
        {branchTotal > 1 && (
          <span className="flex items-center gap-0.5 text-[10.5px] text-[var(--color-text-faint)] font-technical">
            <button
              onClick={() => stepBranch(-1)}
              disabled={switchingBranch}
              aria-label="Previous branch"
              className="focus-ring rounded-[2px] hover:text-[var(--color-accent)] disabled:opacity-40"
            >
              <IconChevronRight style={{ transform: "rotate(180deg)" }} />
            </button>
            <button
              onClick={onToggleBranchPanel}
              className="focus-ring rounded-[2px] px-0.5 hover:text-[var(--color-accent)]"
              title="See what's in each branch"
            >
              {branchIndex + 1}/{branchTotal}
            </button>
            <button
              onClick={() => stepBranch(1)}
              disabled={switchingBranch}
              aria-label="Next branch"
              className="focus-ring rounded-[2px] hover:text-[var(--color-accent)] disabled:opacity-40"
            >
              <IconChevronRight />
            </button>
          </span>
        )}
      </div>
      {isEditing ? (
        <div className="flex flex-col gap-2">
          <Textarea
            autoFocus
            rows={3}
            value={editDraft ?? ""}
            onChange={(e) => onEditDraftChange?.(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onSaveEdit?.();
              }
              if (e.key === "Escape") onCancelEdit?.();
            }}
            className="text-[15px]"
          />
          <div className="flex gap-2">
            <Button variant="accent" onClick={onSaveEdit} disabled={!editDraft?.trim() || sending}>
              Save &amp; regenerate
            </Button>
            <Button variant="ghost" onClick={onCancelEdit}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
      <div className={isUser ? "text-[15px] leading-relaxed text-[var(--color-text)]" : "prose-magi"}>
        {!isUser ? renderMarkdown(message.content) : message.content.split("\n").map((line, i) => (
          <p key={i}>{line || " "}</p>
        ))}
      </div>
      )}
      {branchExpanded && siblings.length > 0 && (
        <div className="mt-2 flex flex-col gap-1 rounded-[4px] border border-[var(--color-border)] bg-[var(--color-bg)] p-2">
          {siblings.map((s, i) => (
            <button
              key={s.id}
              onClick={() => onSwitchBranch?.(s.id)}
              disabled={switchingBranch}
              className={`flex flex-col items-start gap-0.5 rounded-[3px] px-2 py-1.5 text-left transition-colors hover:bg-[var(--color-surface-2)] disabled:opacity-60 ${
                i === branchIndex ? "border border-[var(--color-accent)]" : "border border-transparent"
              }`}
            >
              <span className="text-[10px] uppercase tracking-[0.08em] text-[var(--color-text-faint)] font-technical">
                {i === branchIndex ? "Current" : `Branch ${i + 1}`}
              </span>
              <span className="text-[12px] text-[var(--color-text-muted)]">{s.preview || "(empty)"}</span>
            </button>
          ))}
        </div>
      )}
      {files && files.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {files.map((f) => (
            <span
              key={f.id}
              className="flex items-center gap-1.5 rounded-[3px] border border-[var(--color-border-strong)] bg-[var(--color-bg-raised)] px-2 py-1 text-[11.5px] text-[var(--color-text-muted)] transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-text)]"
            >
              <ArtifactViewerButton
                artifactId={f.id}
                onRestored={onArtifactRestored}
                className="flex items-center gap-1.5"
              >
                <IconDocument className="shrink-0" />
                {f.title} <span className="text-[var(--color-text-faint)]">v{f.version}</span>
              </ArtifactViewerButton>
              {f.mime_type && (
                <a
                  href={`/api/artifacts/${f.id}/file`}
                  download
                  aria-label="Download"
                  title="Download"
                  className="focus-ring text-[var(--color-text-faint)] hover:text-[var(--color-accent)]"
                >
                  <IconDownload />
                </a>
              )}
            </span>
          ))}
        </div>
      )}
      {!isUser && onRemember && (
        <div className="mt-2 flex gap-3 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            onClick={() => onRemember(message.content, "project", message.id)}
            className="text-[11px] text-[var(--color-text-faint)] hover:text-[var(--color-accent)] transition-colors"
          >
            Remember in Project
          </button>
          <button
            onClick={() => onRemember(message.content, "global", message.id)}
            className="text-[11px] text-[var(--color-text-faint)] hover:text-[var(--color-accent)] transition-colors"
          >
            Remember globally
          </button>
          {people && people.length > 0 && (
            <button
              onClick={() => onStartRememberPerson?.(message.id)}
              className="text-[11px] text-[var(--color-text-faint)] hover:text-[var(--color-accent)] transition-colors"
            >
              Remember about a person
            </button>
          )}
          <button
            onClick={() => onStartSaveArtifact?.(message.id)}
            className="text-[11px] text-[var(--color-text-faint)] hover:text-[var(--color-accent)] transition-colors"
          >
            Save as artifact
          </button>
          {onRegenerate && (
            <button
              onClick={onRegenerate}
              disabled={sending}
              className="flex items-center gap-1 text-[11px] text-[var(--color-text-faint)] hover:text-[var(--color-accent)] transition-colors disabled:opacity-40"
            >
              <IconRefresh /> Regenerate
            </button>
          )}
        </div>
      )}
      {isUser && !isEditing && onStartEdit && !message.hasAttachments && (
        <div className="mt-2 flex gap-3 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            onClick={onStartEdit}
            disabled={sending}
            className="flex items-center gap-1 text-[11px] text-[var(--color-text-faint)] hover:text-[var(--color-accent)] transition-colors disabled:opacity-40"
          >
            <IconEdit /> Edit
          </button>
        </div>
      )}
      {savingArtifact && (
        <div className="mt-2 flex items-center gap-2">
          <Input
            autoFocus
            value={artifactTitleDraft ?? ""}
            onChange={(e) => onArtifactTitleChange?.(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onConfirmSaveArtifact?.(message.content);
              if (e.key === "Escape") onCancelSaveArtifact?.();
            }}
            placeholder="Title for this artifact"
            className="max-w-[260px]"
          />
          <Button variant="accent" onClick={() => onConfirmSaveArtifact?.(message.content)} disabled={!artifactTitleDraft?.trim()}>
            Save
          </Button>
          <Button variant="ghost" onClick={onCancelSaveArtifact}>
            Cancel
          </Button>
        </div>
      )}
      {/* The point of this route is the link: a fact recorded here carries the
          exact message it came from, which is the one thing typing it on the
          person's page loses. */}
      {rememberingPerson && (
        <div className="mt-2 flex items-center gap-2">
          <select
            autoFocus
            value={rememberPersonId ?? ""}
            onChange={(e) => onRememberPersonChange?.(e.target.value)}
            className="focus-ring rounded-[3px] border border-[var(--color-border-strong)] bg-[var(--color-bg)] px-2 py-1.5 text-[13px] text-[var(--color-text)]"
          >
            <option value="">Who is this about?</option>
            {people?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.relationship ? ` — ${p.relationship}` : ""}
              </option>
            ))}
          </select>
          <Button
            variant="accent"
            onClick={() => onConfirmRememberPerson?.(message.content)}
            disabled={!rememberPersonId}
          >
            Remember
          </Button>
          <Button variant="ghost" onClick={onCancelRememberPerson}>
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}
