import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

// Magi's data lives in a single local SQLite file. Local-first, portable,
// owned by the user — not a remote database the app depends on to function.
//
// MAGI_DATA_DIR exists so the test suite can point at a throwaway directory
// (see tests/setup.ts). Nothing in the app sets it; without it the location is
// exactly what it always was.
// The turbopackIgnore comments are required because the env var makes this
// path non-static, and Turbopack otherwise traces the entire project into the
// server bundle rather than the one directory actually being read. The path is
// deliberate and known-good, which is exactly the case that opt-out is for.
const dataDir = process.env.MAGI_DATA_DIR ?? path.join(process.cwd(), "data");
if (!fs.existsSync(/*turbopackIgnore: true*/ dataDir)) {
  fs.mkdirSync(/*turbopackIgnore: true*/ dataDir, { recursive: true });
}
const dbPath = path.join(dataDir, "magi.db");

declare global {
  var __magiDb: Database.Database | undefined;
}

function createDb() {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return db;
}

export const db = globalThis.__magiDb ?? createDb();
if (process.env.NODE_ENV !== "production") globalThis.__magiDb = db;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  tagline TEXT,
  purpose TEXT,
  instructions TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'Untitled conversation',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  model TEXT,
  provenance TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS memory (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  source TEXT,
  status TEXT NOT NULL DEFAULT 'established',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  conversation_id TEXT,
  title TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'document',
  content TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  parent_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL DEFAULT 'global',
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  instructions TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS councils (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL DEFAULT 'global',
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  roles TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS council_runs (
  id TEXT PRIMARY KEY,
  council_id TEXT REFERENCES councils(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  transcript TEXT NOT NULL,
  consensus TEXT,
  disagreement TEXT,
  synthesis TEXT,
  status TEXT NOT NULL DEFAULT 'running',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS model_roles (
  role TEXT PRIMARY KEY,
  model_id TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS role_reasoning_effort (
  role TEXT PRIMARY KEY,
  effort TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  objective TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  steps TEXT NOT NULL DEFAULT '[]',
  artifact_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS style_guides (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS characters (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  reference_image_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS images (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  prompt TEXT NOT NULL,
  model TEXT NOT NULL,
  style_guide_id TEXT REFERENCES style_guides(id) ON DELETE SET NULL,
  character_ids TEXT NOT NULL DEFAULT '[]',
  source_image_id TEXT REFERENCES images(id) ON DELETE SET NULL,
  file_path TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT 'image/png',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  message_id TEXT REFERENCES messages(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_path TEXT NOT NULL,
  kind TEXT NOT NULL,
  extracted_text TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS project_connections (
  id TEXT PRIMARY KEY,
  source_project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  target_project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'running',
  findings TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- "Who might be interested in this?" — one investigation of a Project against
-- the people the user knows. Same fire-and-forget shape as project_connections
-- (a row created 'running', findings appended as they arrive, the client
-- polling): a separate table rather than an overloaded one, because the
-- question is Project→person, not Project→Project.
CREATE TABLE IF NOT EXISTS people_interest_runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'running',
  findings TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS usage_events (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  source TEXT NOT NULL,
  source_id TEXT,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  role TEXT,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL,
  created_at TEXT NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
  kind, ref_id, project_id, title, content, created_at
);

CREATE TABLE IF NOT EXISTS embeddings (
  kind TEXT NOT NULL,
  ref_id TEXT NOT NULL,
  project_id TEXT,
  model TEXT NOT NULL,
  title TEXT NOT NULL,
  snippet TEXT NOT NULL,
  vector BLOB NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (kind, ref_id)
);

-- One drafted close-out of a conversation-as-episode. The draft itself is only
-- a summary plus a pointer to how far it read; the things it *proposes* live as
-- ordinary memory rows (status 'suggested') and project_notes rows (status
-- 'proposed'), so a proposal is never trapped inside a dialog the user closed.
CREATE TABLE IF NOT EXISTS episode_closures (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  summary TEXT NOT NULL DEFAULT '',
  message_count INTEGER NOT NULL DEFAULT 0,
  through_message_id TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- What a Project has settled and what it still hasn't. Fed by episode closings
-- and reviewed by hand: 'proposed' is a draft nothing acts on, 'open' and
-- 'settled' are the states a human put it in.
CREATE TABLE IF NOT EXISTS project_notes (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'proposed',
  conversation_id TEXT,
  closure_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- The people connected to the user's work. Deliberately not a contact record:
-- there is no phone number, no email, no address book, and nothing syncs. What
-- is actually stored about a person is their *facts*, which are ordinary memory
-- rows (scope 'person', person_id set) — so they inherit established/suggested
-- status, claim-level provenance, dating, and the rule that a suggestion is
-- inert until kept. aliases is a JSON array of exact alternate names; matching
-- is never fuzzy, because a wrong merge in a rolodex is worse than a miss.
CREATE TABLE IF NOT EXISTS people (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  aliases TEXT NOT NULL DEFAULT '[]',
  relationship TEXT,
  summary TEXT,
  status TEXT NOT NULL DEFAULT 'established',
  closure_id TEXT,
  source_conversation_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- A person crosses Projects — that is the entire point of them being global.
-- Association is therefore a relationship, not a scope.
CREATE TABLE IF NOT EXISTS project_people (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  person_id  TEXT NOT NULL REFERENCES people(id)   ON DELETE CASCADE,
  role TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (project_id, person_id)
);

-- Passage-level index over the same material search_index mirrors at whole-item
-- granularity. This is what retrieval-first context assembly reads from: one
-- row per ~1200-character passage, with its own vector, so a turn can be given
-- the relevant paragraphs of a 200KB document instead of the document's first
-- 12KB. vector/model stay NULL until the passage is embedded (embedding is
-- optional — chunk_search below still gives keyword retrieval at passage
-- granularity without any embedding model configured).
CREATE TABLE IF NOT EXISTS chunks (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  ref_id TEXT NOT NULL,
  project_id TEXT,
  title TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  source_date TEXT NOT NULL,
  model TEXT,
  vector BLOB,
  updated_at TEXT NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS chunk_search USING fts5(chunk_id, content);

CREATE INDEX IF NOT EXISTS idx_conversations_project ON conversations(project_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_memory_project ON memory(project_id);
CREATE INDEX IF NOT EXISTS idx_documents_project ON documents(project_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_project ON artifacts(project_id);
CREATE INDEX IF NOT EXISTS idx_skills_project ON skills(project_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_project ON agent_runs(project_id);
CREATE INDEX IF NOT EXISTS idx_style_guides_project ON style_guides(project_id);
CREATE INDEX IF NOT EXISTS idx_characters_project ON characters(project_id);
CREATE INDEX IF NOT EXISTS idx_images_project ON images(project_id);
CREATE INDEX IF NOT EXISTS idx_attachments_conversation ON attachments(conversation_id);
CREATE INDEX IF NOT EXISTS idx_attachments_message ON attachments(message_id);
CREATE INDEX IF NOT EXISTS idx_project_connections_source ON project_connections(source_project_id);
CREATE INDEX IF NOT EXISTS idx_usage_events_project ON usage_events(project_id);
CREATE INDEX IF NOT EXISTS idx_usage_events_created ON usage_events(created_at);
CREATE INDEX IF NOT EXISTS idx_embeddings_project ON embeddings(project_id);
CREATE INDEX IF NOT EXISTS idx_embeddings_model ON embeddings(model);
CREATE INDEX IF NOT EXISTS idx_chunks_ref ON chunks(kind, ref_id);
CREATE INDEX IF NOT EXISTS idx_chunks_project ON chunks(project_id);
CREATE INDEX IF NOT EXISTS idx_chunks_model ON chunks(model);
CREATE INDEX IF NOT EXISTS idx_episode_closures_conversation ON episode_closures(conversation_id);
CREATE INDEX IF NOT EXISTS idx_project_notes_project ON project_notes(project_id);
CREATE INDEX IF NOT EXISTS idx_people_status ON people(status);
CREATE INDEX IF NOT EXISTS idx_people_interest_runs_project ON people_interest_runs(project_id);
CREATE INDEX IF NOT EXISTS idx_project_people_person ON project_people(person_id);
`;

db.exec(SCHEMA);

// Columns added after initial release — CREATE TABLE IF NOT EXISTS above
// doesn't retrofit existing databases, so new columns are migrated here.
// SQLite has no ADD COLUMN IF NOT EXISTS; the try/catch is the idiomatic
// way to make this safe to run on every startup.
function addColumnIfMissing(table: string, column: string, definition: string) {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  } catch (err) {
    if (!(err instanceof Error) || !/duplicate column name/i.test(err.message)) throw err;
  }
}

addColumnIfMissing("skills", "allowed_tools", "TEXT");
// A Skill is meant to be a *method* — model, tools, decision rules, iteration
// — not just a system-prompt block. model_role is which model role the method
// wants; stages is an optional ordered pipeline (JSON) that Agents can run in
// place of their built-in one. Both null means the plain single-pass Skill
// that every existing Skill already is.
addColumnIfMissing("skills", "model_role", "TEXT");
addColumnIfMissing("skills", "stages", "TEXT");
addColumnIfMissing("agent_runs", "allowed_tools", "TEXT");
// Which Skill's staged pipeline this Agent run followed, if any.
addColumnIfMissing("agent_runs", "skill_id", "TEXT");
addColumnIfMissing("council_runs", "mode", "TEXT NOT NULL DEFAULT 'independent'");
addColumnIfMissing("documents", "mime_type", "TEXT");
addColumnIfMissing("documents", "file_path", "TEXT");
addColumnIfMissing("artifacts", "mime_type", "TEXT");
addColumnIfMissing("artifacts", "file_path", "TEXT");
addColumnIfMissing("artifacts", "message_id", "TEXT");
addColumnIfMissing("projects", "brand_philosophy", "TEXT");
addColumnIfMissing("projects", "brand_heading_font", "TEXT");
addColumnIfMissing("projects", "brand_body_font", "TEXT");
addColumnIfMissing("projects", "brand_primary_color", "TEXT");
addColumnIfMissing("projects", "brand_accent_color", "TEXT");
addColumnIfMissing("projects", "brand_text_color", "TEXT");
addColumnIfMissing("projects", "brand_subtitle_color", "TEXT");
addColumnIfMissing("projects", "brand_label_color", "TEXT");
addColumnIfMissing("projects", "brand_secondary_accent_color", "TEXT");
addColumnIfMissing("projects", "parent_project_id", "TEXT REFERENCES projects(id) ON DELETE SET NULL");
addColumnIfMissing("projects", "pinned", "INTEGER NOT NULL DEFAULT 0");
db.exec(`CREATE INDEX IF NOT EXISTS idx_projects_parent ON projects(parent_project_id)`);
addColumnIfMissing("images", "source", "TEXT NOT NULL DEFAULT 'generated'");
addColumnIfMissing("council_runs", "attachments", "TEXT NOT NULL DEFAULT '[]'");
// Rolling summary of the turns that have aged out of a conversation's live
// window — see src/lib/conversationWindow.ts. through_id is how the fold stays
// incremental: only messages after it need summarizing again.
addColumnIfMissing("conversations", "summary", "TEXT");
addColumnIfMissing("conversations", "summary_through_id", "TEXT");
addColumnIfMissing("conversations", "summary_message_count", "INTEGER NOT NULL DEFAULT 0");
addColumnIfMissing("conversations", "summary_updated_at", "TEXT");
// Which episode closing proposed this memory item, so the review UI can find
// the proposals belonging to one draft.
addColumnIfMissing("memory", "closure_id", "TEXT");
// Claim-level provenance: which message, in which conversation, a remembered
// fact actually came from — so "where did that come from?" resolves to a place
// in the app rather than to a free-text `source` label.
addColumnIfMissing("memory", "source_message_id", "TEXT");
addColumnIfMissing("memory", "source_conversation_id", "TEXT");
// A fact about a person. Set together with scope = 'person', which is a value
// neither branch of listMemory() matches — so person facts cannot reach the
// global or Project memory blocks of a system prompt by accident. They get
// there only by the deliberate routes the People feature adds.
addColumnIfMissing("memory", "person_id", "TEXT");
db.exec(`CREATE INDEX IF NOT EXISTS idx_memory_person ON memory(person_id)`);
// An association proposed by closing a conversation is itself an inference,
// and inferences are never established here — being on a Project's roster puts
// a person into every prompt in that Project, which is exactly the kind of
// effect a proposal must not have before someone agrees to it. A person can be
// established while their association with this Project is still proposed.
addColumnIfMissing("project_people", "status", "TEXT NOT NULL DEFAULT 'established'");
addColumnIfMissing("project_people", "closure_id", "TEXT");
// Before those columns existed, the origin of a conversation-sourced memory
// item was stuffed into the free-text `source` field — as a bare conversation
// id by the "Remember" action, and as "episode:<id>" by an episode closing.
// Both are recoverable, so existing items get real links rather than being
// stuck displaying an id.
db.exec(
  `UPDATE memory SET source_conversation_id = substr(source, 9)
   WHERE source_conversation_id IS NULL AND source LIKE 'episode:conv\\_%' ESCAPE '\\'`
);
db.exec(
  `UPDATE memory SET source_conversation_id = source
   WHERE source_conversation_id IS NULL AND source LIKE 'conv\\_%' ESCAPE '\\'`
);
// Suggested memory used to be indexed like any other row, which made a
// proposal retrievable into a prompt as a cited passage — defeating the point
// of it being inert until kept. Writes no longer index them; this clears the
// ones written before that. Raw SQL rather than indexRemove() because db.ts
// cannot import the index layer without a cycle.
db.exec(
  `DELETE FROM chunk_search WHERE chunk_id IN (
     SELECT c.id FROM chunks c JOIN memory m ON m.id = c.ref_id
     WHERE c.kind = 'memory' AND m.status = 'suggested'
   )`
);
db.exec(
  `DELETE FROM chunks WHERE kind = 'memory' AND ref_id IN (
     SELECT id FROM memory WHERE status = 'suggested'
   )`
);
db.exec(
  `DELETE FROM embeddings WHERE kind = 'memory' AND ref_id IN (
     SELECT id FROM memory WHERE status = 'suggested'
   )`
);
db.exec(
  `DELETE FROM search_index WHERE kind = 'memory' AND ref_id IN (
     SELECT id FROM memory WHERE status = 'suggested'
   )`
);

export function nowIso() {
  return new Date().toISOString();
}

export function newId(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}
