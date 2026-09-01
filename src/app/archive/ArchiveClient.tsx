"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button, EmptyState, Input, Tag } from "@/components/ui";
import { IconSearch } from "@/components/icons";
import { renderMarkdown } from "@/lib/markdownToReact";

interface SearchResult {
  kind: string;
  refId: string;
  projectId: string | null;
  title: string;
  snippet: string;
  createdAt: string;
  similarity?: number;
}

function highlightSnippet(snippet: string): string {
  const escaped = snippet.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return escaped.replace(/⟦/g, "<mark>").replace(/⟧/g, "</mark>");
}

const KIND_LABEL: Record<string, string> = {
  project: "Project",
  conversation: "Conversation",
  message: "Message",
  memory: "Memory",
  document: "Document",
  artifact: "Artifact",
  skill: "Skill",
  style_guide: "Style Guide",
  character: "Character",
};

function hrefFor(r: SearchResult): string {
  switch (r.kind) {
    case "project":
      return `/projects/${r.refId}`;
    case "conversation":
      return `/projects/${r.projectId}/c/${r.refId}`;
    case "message":
      return `/projects/${r.projectId}`;
    case "style_guide":
    case "character":
      return r.projectId ? `/image-lab?project=${r.projectId}` : "/image-lab";
    default:
      return r.projectId ? `/projects/${r.projectId}` : "/archive";
  }
}

export function ArchiveClient() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [mode, setMode] = useState<"search" | "ask">("search");
  const [searchStyle, setSearchStyle] = useState<"wording" | "meaning">("wording");
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [answerSources, setAnswerSources] = useState<SearchResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);

  useEffect(() => {
    if (mode !== "search" || !query.trim()) {
      if (mode === "search") {
        setResults([]);
        setSearchError(null);
      }
      return;
    }
    const handle = setTimeout(async () => {
      const endpoint = searchStyle === "meaning" ? "/api/search/semantic" : "/api/search";
      const res = await fetch(`${endpoint}?q=${encodeURIComponent(query)}`);
      if (res.status === 412) {
        const data = await res.json();
        setSearchError(data.message);
        setResults([]);
        return;
      }
      setSearchError(null);
      const data = await res.json();
      setResults(data.results ?? []);
    }, 150);
    return () => clearTimeout(handle);
  }, [query, mode, searchStyle]);

  async function ask() {
    if (!query.trim()) return;
    setAsking(true);
    setError(null);
    setAnswer(null);
    const res = await fetch("/api/archive/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: query }),
    });
    if (res.status === 412) {
      const data = await res.json();
      setError(data.message);
      setAsking(false);
      return;
    }
    const data = await res.json();
    setAnswer(data.answer);
    setAnswerSources(data.sources ?? []);
    setAsking(false);
  }

  return (
    <div className="mx-auto max-w-2xl px-8 py-8">
      <div className="mb-4 flex items-center gap-2">
        <div className="relative flex-1">
          <IconSearch className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-faint)]" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && mode === "ask") ask();
            }}
            placeholder={mode === "search" ? "Search by meaning or wording…" : "Ask a question about your archive…"}
            className="pl-8"
          />
        </div>
        <div className="flex rounded-[3px] border border-[var(--color-border-strong)] overflow-hidden">
          <button
            onClick={() => setMode("search")}
            className={`px-3 py-1.5 text-[12px] transition-colors ${mode === "search" ? "bg-[var(--color-accent)] text-[var(--color-accent-contrast)]" : "text-[var(--color-text-muted)] hover:bg-[var(--color-surface)]"}`}
          >
            Search
          </button>
          <button
            onClick={() => setMode("ask")}
            className={`px-3 py-1.5 text-[12px] transition-colors ${mode === "ask" ? "bg-[var(--color-accent)] text-[var(--color-accent-contrast)]" : "text-[var(--color-text-muted)] hover:bg-[var(--color-surface)]"}`}
          >
            Ask
          </button>
        </div>
      </div>

      {mode === "ask" && (
        <div className="mb-6">
          <Button variant="accent" onClick={ask} disabled={!query.trim() || asking}>
            {asking ? "Consulting the archive…" : "Ask my archive"}
          </Button>
          {error && (
            <div className="mt-3 rounded-[4px] border border-[var(--color-accent)] bg-[var(--color-surface)] px-4 py-3 text-[13px] text-[var(--color-text)]">
              {error}{" "}
              <Link href="/settings" className="text-[var(--color-accent)] underline">
                Open Settings
              </Link>
            </div>
          )}
          {answer && (
            <div className="mt-4 rounded-[4px] border border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-4">
              <div className="prose-magi text-[15px]">
                {renderMarkdown(answer)}
              </div>
              {answerSources.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-1.5 border-t border-[var(--color-border)] pt-3">
                  {answerSources.map((s, i) => (
                    <Link key={i} href={hrefFor(s)} className="text-[11px] text-[var(--color-text-faint)] hover:text-[var(--color-accent)] transition-colors">
                      [{i + 1}] {s.title}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {mode === "search" && (
        <>
          <div className="mb-4 flex items-center gap-1.5 text-[12px]">
            <span className="text-[var(--color-text-faint)]">Match</span>
            <button
              onClick={() => setSearchStyle("wording")}
              className={`rounded-[3px] px-2 py-1 transition-colors ${searchStyle === "wording" ? "bg-[var(--color-surface-2)] text-[var(--color-text)]" : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"}`}
            >
              Wording
            </button>
            <button
              onClick={() => setSearchStyle("meaning")}
              className={`rounded-[3px] px-2 py-1 transition-colors ${searchStyle === "meaning" ? "bg-[var(--color-surface-2)] text-[var(--color-text)]" : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"}`}
            >
              Meaning
            </button>
          </div>

          {searchError && (
            <div className="mb-4 rounded-[4px] border border-[var(--color-accent)] bg-[var(--color-surface)] px-4 py-3 text-[13px] text-[var(--color-text)]">
              {searchError}{" "}
              <Link href="/settings" className="text-[var(--color-accent)] underline">
                Open Settings
              </Link>
            </div>
          )}

          {!searchError && query.trim() && results.length === 0 && (
            <EmptyState title="No matches" description={searchStyle === "meaning" ? "Nothing close enough in meaning yet." : "Try different wording."} />
          )}
          <div className="flex flex-col gap-1.5">
            {results.map((r, i) => (
              <Link key={i} href={hrefFor(r)}>
                <div className="rounded-[4px] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 transition-colors hover:border-[var(--color-border-strong)]">
                  <div className="mb-1 flex items-center gap-2">
                    <Tag tone="accent">{KIND_LABEL[r.kind] ?? r.kind}</Tag>
                    <span className="truncate text-[13.5px] text-[var(--color-text)]">{r.title}</span>
                    {r.similarity !== undefined && (
                      <span className="ml-auto shrink-0 text-[11px] text-[var(--color-text-faint)] font-technical">
                        {Math.round(r.similarity * 100)}% match
                      </span>
                    )}
                  </div>
                  <div
                    className="truncate text-[12.5px] text-[var(--color-text-muted)]"
                    dangerouslySetInnerHTML={{ __html: highlightSnippet(r.snippet) }}
                  />
                </div>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
