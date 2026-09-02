import { db } from "@/lib/db";

// Every table the suite writes to, child-first so foreign keys never block a
// delete. Tests share one database per file, so this is what keeps them
// order-independent.
const TABLES = [
  "chunk_search",
  "chunks",
  "embeddings",
  "search_index",
  "usage_events",
  "project_notes",
  "episode_closures",
  "attachments",
  "artifacts",
  "messages",
  "conversations",
  "project_people",
  "memory",
  "people",
  "documents",
  "skills",
  "councils",
  "council_runs",
  "agent_runs",
  "project_connections",
  "people_interest_runs",
  "images",
  "characters",
  "style_guides",
  "projects",
  "settings",
  "model_roles",
  "role_reasoning_effort",
];

export function resetDb() {
  db.pragma("foreign_keys = OFF");
  for (const table of TABLES) db.prepare(`DELETE FROM ${table}`).run();
  db.pragma("foreign_keys = ON");
}
