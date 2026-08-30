// Tavily-backed web_search/web_fetch tools. A direct fetch call rather than an
// SDK — Tavily has no first-party TS client, and the request/response shapes
// here are taken verbatim from Tavily's own API reference, not guessed.
import { getTavilyApiKey } from "@/lib/settings";

const TAVILY_BASE = "https://api.tavily.com";
const NOT_CONFIGURED = "Web search isn't configured — add a Tavily API key in Settings.";
const MAX_EXTRACT_CHARS = 8000;

interface TavilySearchResult {
  title: string;
  url: string;
  content: string;
}

interface TavilySearchResponse {
  results: TavilySearchResult[];
}

interface TavilyExtractResponse {
  results: { url: string; raw_content: string }[];
  failed_results: { url: string; error: string }[];
}

async function tavilyRequest<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const apiKey = getTavilyApiKey();
  if (!apiKey) throw new Error(NOT_CONFIGURED);
  const res = await fetch(`${TAVILY_BASE}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Tavily request failed (${res.status}): ${text.slice(0, 300) || res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export async function searchWeb(query: string, maxResults?: number): Promise<string> {
  const data = await tavilyRequest<TavilySearchResponse>("/search", {
    query,
    max_results: Math.min(Math.max(maxResults ?? 5, 1), 10),
    search_depth: "basic",
  });
  if (!data.results.length) return "No results found.";
  return data.results.map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.content}`).join("\n\n");
}

export async function fetchWebPage(url: string): Promise<string> {
  const data = await tavilyRequest<TavilyExtractResponse>("/extract", { urls: [url], format: "text" });
  const failure = data.failed_results[0];
  if (failure) throw new Error(failure.error || `Could not extract content from ${url}`);
  const raw = data.results[0]?.raw_content;
  if (!raw) return "The page had no extractable text content.";
  return raw.length > MAX_EXTRACT_CHARS ? `${raw.slice(0, MAX_EXTRACT_CHARS)}\n\n[content truncated]` : raw;
}
