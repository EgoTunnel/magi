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
