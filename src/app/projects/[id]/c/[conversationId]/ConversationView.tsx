"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button, Input, Tag } from "@/components/ui";
import { IconAttach, IconChevronDown, IconChevronRight, IconDocument, IconDownload, IconRefresh, IconSend, IconStop, IconTrash } from "@/components/icons";
import type { ContextProvenance } from "@/lib/contextBuilder";
import { arrayBufferToBase64 } from "@/lib/clientFiles";
import { ArtifactViewerButton } from "@/components/ArtifactHistory";
import { MagiSpinner } from "@/components/MagiSpinner";

interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  model: string | null;
  provenance: string | null;
  created_at: string;
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
  const [projectName, setProjectName] = useState("");
  const [title, setTitle] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [toolStatus, setToolStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [skillId, setSkillId] = useState<string>("");
  const [roles, setRoles] = useState<RoleInfo[]>([]);
  const [modelRole, setModelRole] = useState("default");
  const [contextOpen, setContextOpen] = useState(false);
  const [savingArtifactFor, setSavingArtifactFor] = useState<string | null>(null);
  const [artifactTitleDraft, setArtifactTitleDraft] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [artifactFiles, setArtifactFiles] = useState<ArtifactFile[]>([]);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastMessageRef = useRef<HTMLDivElement>(null);
  const attachFileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Landing scroll (jump straight to the latest messages) fires once per
  // conversation visit; every load() after that (post-turn refresh) must NOT
  // re-trigger it, or it'd yank the view back down right as a long response
  // that was deliberately left pinned near the top finishes streaming.
  const initialScrollDoneRef = useRef(false);

  async function load() {
    const [convRes, skillsRes, modelsRes, artifactsRes] = await Promise.all([
      fetch(`/api/conversations/${conversationId}`),
      fetch(`/api/skills?projectId=${projectId}`),
      fetch(`/api/models`),
      fetch(`/api/artifacts?conversationId=${conversationId}`),
    ]);
    const convData = await convRes.json();
    setTitle(convData.conversation?.title ?? "");
    setMessages(convData.messages ?? []);
    setSkills((await skillsRes.json()).skills ?? []);
    setRoles((await modelsRes.json()).roles ?? []);
    setArtifactFiles((await artifactsRes.json()).artifacts ?? []);

    const projRes = await fetch(`/api/projects/${projectId}`);
    const projData = await projRes.json();
    setProjectName(projData.project?.name ?? "");
  }

  useEffect(() => {
    initialScrollDoneRef.current = false;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  // Landing on a conversation: jump straight to its latest messages, once.
  useEffect(() => {
    if (!initialScrollDoneRef.current && messages.length > 0 && scrollRef.current) {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight });
      initialScrollDoneRef.current = true;
    }
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
  // out from under a scroll position that used to be at the bottom.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => {
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      setShowJumpToLatest(distanceFromBottom > 160);
    };
    update();
    el.addEventListener("scroll", update);
    return () => el.removeEventListener("scroll", update);
  }, [messages, streamingText]);

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
        setStreamingText(full);
      } else if (event.type === "tool_start" && event.name) {
        setToolStatus(event.name);
      } else if (event.type === "tool_end") {
        setToolStatus(null);
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
      { id: `local-${Date.now()}`, role: "user", content, model: null, provenance: null, created_at: new Date().toISOString() },
    ]);
    setStreamingText("");
    setToolStatus(null);
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
      setStreamingText("");
      setToolStatus(null);
      setSending(false);
      abortRef.current = null;
      await load();
    }
  }

  function stop() {
    abortRef.current?.abort();
  }

  async function regenerate() {
    if (sending) return;
    const last = messages[messages.length - 1];
    if (!last || last.role !== "assistant") return;
    setMessages((m) => m.slice(0, -1));
    setSending(true);
    setError(null);
    setStreamingText("");
    setToolStatus(null);
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(`/api/conversations/${conversationId}/chat/regenerate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skillId: skillId || undefined, modelRole }),
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
      setStreamingText("");
      setToolStatus(null);
      setSending(false);
      abortRef.current = null;
      await load();
    }
  }

  async function rememberMessage(content: string, scope: "global" | "project") {
    await fetch("/api/memory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope, projectId: scope === "project" ? projectId : undefined, content, source: conversationId }),
    });
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

  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
  const provenance: ContextProvenance | null = lastAssistant?.provenance ? JSON.parse(lastAssistant.provenance) : null;

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
        <button
          onClick={() => setContextOpen((v) => !v)}
          className="focus-ring rounded-[3px] border border-[var(--color-border)] px-2 py-1 text-[11px] uppercase tracking-[0.08em] text-[var(--color-text-faint)] font-technical hover:text-[var(--color-text)] transition-colors"
        >
          Context
        </button>
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
                <div key={m.id} ref={i === messages.length - 1 ? lastMessageRef : undefined}>
                  <MessageBlock
                    message={m}
                    files={artifactFiles.filter((a) => a.message_id === m.id)}
                    onRemember={rememberMessage}
                    onStartSaveArtifact={startSaveArtifact}
                    savingArtifact={savingArtifactFor === m.id}
                    artifactTitleDraft={artifactTitleDraft}
                    onArtifactTitleChange={setArtifactTitleDraft}
                    onConfirmSaveArtifact={confirmSaveArtifact}
                    onCancelSaveArtifact={cancelSaveArtifact}
                    onArtifactRestored={load}
                    isLast={i === messages.length - 1}
                    onRegenerate={regenerate}
                    sending={sending}
                  />
                </div>
              ))}
              {sending && (
                <MessageBlock
                  message={{ id: "streaming", role: "assistant", content: streamingText, model: null, provenance: null, created_at: "" }}
                  streaming
                  toolStatus={toolStatus}
                />
              )}
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
                <div>{provenance.usedInstructions ? "Project instructions applied" : "No Project instructions set"}</div>
                <div>{provenance.globalMemoryCount} global memory item(s)</div>
                <div>{provenance.projectMemoryCount} Project memory item(s)</div>
                {provenance.documentsUsed.length > 0 && (
                  <div>
                    <div className="mb-1 text-[var(--color-text-faint)]">Documents</div>
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
              accept=".pdf,.docx,.txt,.md,.csv,.json,image/png,image/jpeg,image/webp,image/gif"
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

function MessageBlock({
  message,
  streaming,
  toolStatus,
  files,
  onRemember,
  onStartSaveArtifact,
  savingArtifact,
  artifactTitleDraft,
  onArtifactTitleChange,
  onConfirmSaveArtifact,
  onCancelSaveArtifact,
  onArtifactRestored,
  isLast,
  onRegenerate,
  sending,
}: {
  message: Message;
  streaming?: boolean;
  toolStatus?: string | null;
  files?: ArtifactFile[];
  onRemember?: (content: string, scope: "global" | "project") => void;
  onStartSaveArtifact?: (messageId: string) => void;
  savingArtifact?: boolean;
  artifactTitleDraft?: string;
  onArtifactTitleChange?: (title: string) => void;
  onConfirmSaveArtifact?: (content: string) => void;
  onCancelSaveArtifact?: () => void;
  onArtifactRestored?: () => void;
  isLast?: boolean;
  onRegenerate?: () => void;
  sending?: boolean;
}) {
  const isUser = message.role === "user";
  return (
    <div className="group">
      <div className="mb-1.5 flex items-center gap-2">
        <span className="text-[10.5px] font-medium uppercase tracking-[0.1em] text-[var(--color-text-faint)] font-technical">
          {isUser ? "You" : "Magi"}
        </span>
        {message.model && <Tag>{message.model}</Tag>}
        {streaming && (
          <span className="flex items-center gap-1.5 text-[10.5px] text-[var(--color-accent)] font-technical">
            <MagiSpinner />
            {toolStatus ? `using ${toolStatus}…` : message.content ? "writing…" : "thinking…"}
          </span>
        )}
      </div>
      <div className={isUser ? "text-[15px] leading-relaxed text-[var(--color-text)]" : "prose-magi"}>
        {message.content.split("\n").map((line, i) => (
          <p key={i}>{line || " "}</p>
        ))}
      </div>
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
      {!isUser && !streaming && onRemember && (
        <div className="mt-2 flex gap-3 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            onClick={() => onRemember(message.content, "project")}
            className="text-[11px] text-[var(--color-text-faint)] hover:text-[var(--color-accent)] transition-colors"
          >
            Remember in Project
          </button>
          <button
            onClick={() => onRemember(message.content, "global")}
            className="text-[11px] text-[var(--color-text-faint)] hover:text-[var(--color-accent)] transition-colors"
          >
            Remember globally
          </button>
          <button
            onClick={() => onStartSaveArtifact?.(message.id)}
            className="text-[11px] text-[var(--color-text-faint)] hover:text-[var(--color-accent)] transition-colors"
          >
            Save as artifact
          </button>
          {isLast && onRegenerate && (
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
    </div>
  );
}
