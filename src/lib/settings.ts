import { db } from "@/lib/db";

export function getSetting(key: string): string | null {
  const row = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string) {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, value);
}

export function deleteSetting(key: string) {
  db.prepare(`DELETE FROM settings WHERE key = ?`).run(key);
}

export function getAnthropicApiKey(): string | null {
  return getSetting("anthropic_api_key") || process.env.ANTHROPIC_API_KEY || null;
}

export function getOpenRouterApiKey(): string | null {
  return getSetting("openrouter_api_key") || process.env.OPENROUTER_API_KEY || null;
}

// Manual fallback provider — see chutes.ts and registry.ts. Configuring this
// never changes what Magi does on its own; it only makes Chutes models
// available to assign to a role in Settings.
export function getChutesApiKey(): string | null {
  return getSetting("chutes_api_key") || process.env.CHUTES_API_KEY || null;
}

// Backs the web_search/web_fetch tools (src/lib/tools/webSearch.ts). When this
// isn't set, OpenRouter-routed models fall back to OpenRouter's own built-in
// web plugin instead — see requestExtras() in models/openrouter.ts — but
// Anthropic-direct calls have no such fallback and the tools simply error.
export function getTavilyApiKey(): string | null {
  return getSetting("tavily_api_key") || process.env.TAVILY_API_KEY || null;
}

// Backs the TypeSafe Jev judge (src/lib/models/typesafe.ts). Setting this is
// the opt-in to a new data flow: with it, the Standing watch sends each
// conversation exchange to TypeSafe to be judged. Without it, the judge falls
// back to the assigned `fast` model, and nothing goes anywhere it wasn't
// already going.
export function getTypeSafeApiKey(): string | null {
  return getSetting("typesafe_api_key") || process.env.TYPESAFE_API_KEY || null;
}

// Whether each conversation turn is checked against the Project's open
// questions and settled decisions (src/lib/standingWatch.ts). On by default:
// the watch only ever proposes, and with no TypeSafe key it runs on the
// already-configured fast model.
export function getStandingWatchEnabled(): boolean {
  const value = getSetting("standing_watch_enabled");
  return value === null ? true : value === "true";
}

export function setStandingWatchEnabled(enabled: boolean) {
  setSetting("standing_watch_enabled", enabled ? "true" : "false");
}

// Whether Magi's search_archive tool is allowed to look beyond the current
// Project. Defaults on (the vision treats this as ordinary research, not a
// silently blurred boundary) but the user can turn it off in Settings.
export function getCrossProjectSearchEnabled(): boolean {
  const value = getSetting("cross_project_search_enabled");
  return value === null ? true : value === "true";
}

export function setCrossProjectSearchEnabled(enabled: boolean) {
  setSetting("cross_project_search_enabled", enabled ? "true" : "false");
}

// The one embedding model semantic search is currently built against.
// Vectors from different models aren't comparable, so this is a single
// global choice rather than a per-role assignment like chat models.
export function getEmbeddingModelId(): string | null {
  return getSetting("embedding_model_id");
}

export function setEmbeddingModelId(modelId: string) {
  setSetting("embedding_model_id", modelId);
}

// Base URL of an OpenAI-compatible server on this machine (Ollama's
// http://localhost:11434/v1, LM Studio's http://localhost:1234/v1, or
// anything else of that shape) that can serve embeddings. Setting this is what
// makes the archive's semantic half independent of any remote vendor: with a
// local model chosen, retrieval keeps working with the network unplugged.
export function getLocalEmbeddingBaseUrl(): string | null {
  const raw = getSetting("local_embedding_base_url") || process.env.MAGI_LOCAL_EMBEDDING_URL || null;
  // Stored without a trailing slash so callers can join paths without
  // producing "//v1/models", which some servers 404 on.
  return raw ? raw.trim().replace(/\/+$/, "") : null;
}

export function setLocalEmbeddingBaseUrl(url: string) {
  setSetting("local_embedding_base_url", url.trim());
}

// Tools turned off everywhere, regardless of Skill/Agent-run allowlists —
// permissions can only narrow past this, never widen beyond it.
export function getDisabledTools(): string[] {
  const raw = getSetting("disabled_tools");
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === "string") : [];
  } catch {
    return [];
  }
}

export function setDisabledTools(tools: string[]) {
  setSetting("disabled_tools", JSON.stringify(tools));
}
