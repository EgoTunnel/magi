// Imports a full Claude.ai account data export (Settings > Account > Export
// data) — distinct from claude.ts, which only ever handled a single already-
// unzipped conversations.json. This handles the three category files that
// actually matter (conversations, projects, memories) as their own inputs,
// since Claude ships them as separate per-category zips rather than one
// combined bundle.
//
// Every field name and nesting shape below was confirmed against a real
// export (Aug 2026), not guessed — see the shapes read out in-session before
// this was written. Three things are worth knowing going in:
//
// 1. A conversation object carries no field linking it back to a Claude
//    Project (checked: uuid/name/summary/created_at/updated_at/account/
//    chat_messages, nothing else). Projects and conversations import as
//    siblings — Projects get their docs and Project-scoped memory; all
//    conversations land in one dedicated bucket Project — rather than
//    conversations nesting inside the Project they originally lived in.
// 2. Claude's own Artifacts (the "artifacts" tool) carry their full content
//    inline in the export and become real Magi Artifacts, with revisions to
//    the same Claude artifact id becoming Magi artifact versions. Files
//    generated through the code-execution sandbox (bash_tool/create_file) do
//    NOT carry their finished binary — only the generating source is
//    present — so those import as plain text within the conversation, not
//    as artifacts.
// 3. Images are referenced by an opaque file_uuid with no bytes anywhere in
//    the export — not recoverable.
import { db, newId, nowIso } from "@/lib/db";
import { indexUpsert } from "@/lib/searchIndex";
import { createProject } from "@/lib/repo/projects";

interface ClaudeContentBlock {
  type?: string;
  text?: string;
  name?: string;
  input?: {
    id?: string;
    type?: string;
    title?: string;
    command?: string;
    content?: string;
  };
}
interface ClaudeAttachment {
  file_name?: string;
  extracted_content?: string;
}
interface ClaudeMessage {
  sender?: string;
  text?: string;
  content?: ClaudeContentBlock[];
  created_at?: string;
  attachments?: ClaudeAttachment[];
}
interface ClaudeConversationRaw {
  uuid?: string;
  name?: string;
  created_at?: string;
  chat_messages?: ClaudeMessage[];
}

interface ClaudeProjectDoc {
  filename?: string;
  content?: string;
}
interface ClaudeProjectRaw {
  uuid?: string;
  name?: string;
  description?: string | null;
  prompt_template?: string | null;
  docs?: ClaudeProjectDoc[];
}

interface ClaudeMemoryFile {
  path?: string;
  content?: string;
}
interface ClaudeMemoryRaw {
  conversations_memory?: string;
  project_memories?: Record<string, string>;
  memory_files?: ClaudeMemoryFile[];
}

export interface ClaudeAccountImportInput {
  conversations: unknown;
  projects: unknown[];
  memory: unknown;
}

export interface ClaudeAccountImportSummary {
  projectsCreated: number;
  conversationsImported: number;
  conversationsSkippedEmpty: number;
  documentsImported: number;
  artifactsImported: number;
  memoryItemsImported: number;
  bucketProjectId: string | null;
  projectIds: string[];
}

function extractMessageText(msg: ClaudeMessage): string {
  let text = "";
  if (msg.text && msg.text.trim()) {
    text = msg.text.trim();
  } else if (Array.isArray(msg.content)) {
    text = msg.content
      .filter((b): b is ClaudeContentBlock & { text: string } => b.type === "text" && typeof b.text === "string" && b.text.trim().length > 0)
      .map((b) => b.text.trim())
      .join("\n\n");
  }
  // Same "## Attached: <name>" convention the live chat route uses (see
  // ATTACHMENT_TEXT_BUDGET in chat/route.ts) — pasted-text attachments carry
  // their full extraction inline in the export, so fold it in rather than
  // losing it.
  for (const a of msg.attachments ?? []) {
    if (a.extracted_content && a.extracted_content.trim()) {
      text += `${text ? "\n\n" : ""}## Attached: ${a.file_name ?? "file"}\n${a.extracted_content.trim()}`;
    }
  }
  return text.trim();
}

interface ExtractedArtifact {
  claudeId: string;
  type: string;
  title: string;
  content: string;
}
function extractArtifactBlocks(msg: ClaudeMessage): ExtractedArtifact[] {
  const out: ExtractedArtifact[] = [];
  for (const b of msg.content ?? []) {
    if (b.type !== "tool_use" || b.name !== "artifacts") continue;
    const input = b.input;
    if (!input?.id || !input.content) continue;
    out.push({
      claudeId: input.id,
      type: mapArtifactType(input.type),
      title: input.title?.trim() || input.id,
      content: input.content,
    });
  }
  return out;
}

function mapArtifactType(claudeType: string | undefined): string {
  switch (claudeType) {
    case "application/vnd.ant.code":
      return "code";
    case "text/html":
      return "html";
    case "image/svg+xml":
      return "svg";
    case "application/vnd.ant.react":
      return "react";
    default:
      return "document";
  }
}

function mapRole(sender: string | undefined): "user" | "assistant" | null {
  if (sender === "human") return "user";
  if (sender === "assistant") return "assistant";
  return null;
}

// Mirrors portability.ts's importProject(): raw SQL in one transaction with
// skipEmbedding: true throughout, rather than the higher-level repo
// functions (createDocument/createMemory/etc.), because those fire an
// unthrottled embedding request per call — fine for one user action, not for
// an import that can easily produce several thousand rows at once.
export function importClaudeAccountExport(input: ClaudeAccountImportInput): ClaudeAccountImportSummary {
  const conversations = Array.isArray(input.conversations) ? (input.conversations as ClaudeConversationRaw[]) : [];
  const projects = input.projects.filter((p): p is ClaudeProjectRaw => !!p && typeof p === "object");
  const memory = (input.memory && typeof input.memory === "object" ? input.memory : null) as ClaudeMemoryRaw | null;

  return db.transaction(() => {
    const projectIds: string[] = [];
    let documentsImported = 0;
    let memoryItemsImported = 0;

    // --- Claude Projects -> Magi Projects: name/description/instructions, knowledge docs, project memory ---
    for (const p of projects) {
      if (!p.name) continue;
      const magiProject = createProject({
        name: p.name,
        tagline: p.description ?? undefined,
        instructions: p.prompt_template || undefined,
      });
      projectIds.push(magiProject.id);

      for (const doc of p.docs ?? []) {
        if (!doc.filename || !doc.content) continue;
        const docId = newId("doc");
        const ts = nowIso();
        db.prepare(
          `INSERT INTO documents (id, project_id, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`
        ).run(docId, magiProject.id, doc.filename, doc.content, ts, ts);
        indexUpsert({ kind: "document", refId: docId, projectId: magiProject.id, title: doc.filename, content: doc.content, skipEmbedding: true });
        documentsImported++;
      }

      const projMemory = p.uuid ? memory?.project_memories?.[p.uuid] : undefined;
      if (projMemory && projMemory.trim()) {
        const memId = newId("mem");
        db.prepare(
          `INSERT INTO memory (id, scope, project_id, content, source, status, created_at)
           VALUES (?, 'project', ?, ?, 'import', 'established', ?)`
        ).run(memId, magiProject.id, projMemory, nowIso());
        indexUpsert({ kind: "memory", refId: memId, projectId: magiProject.id, title: "project memory", content: projMemory, skipEmbedding: true });
        memoryItemsImported++;
      }
    }

    // --- Global memory: account-wide summary + individual topic/person notes ---
    if (memory?.conversations_memory && memory.conversations_memory.trim()) {
      const memId = newId("mem");
      db.prepare(
        `INSERT INTO memory (id, scope, project_id, content, source, status, created_at)
         VALUES (?, 'global', NULL, ?, 'import', 'established', ?)`
      ).run(memId, memory.conversations_memory, nowIso());
      indexUpsert({ kind: "memory", refId: memId, projectId: null, title: "global memory", content: memory.conversations_memory, skipEmbedding: true });
      memoryItemsImported++;
    }
    for (const f of memory?.memory_files ?? []) {
      if (!f.content || !f.content.trim()) continue;
      const memId = newId("mem");
      db.prepare(
        `INSERT INTO memory (id, scope, project_id, content, source, status, created_at)
         VALUES (?, 'global', NULL, ?, 'import', 'established', ?)`
      ).run(memId, f.content, nowIso());
      indexUpsert({ kind: "memory", refId: memId, projectId: null, title: f.path ?? "global memory", content: f.content, skipEmbedding: true });
      memoryItemsImported++;
    }

    // --- Conversations: one bucket Project, since nothing links a conversation back to a Claude Project ---
    const nonEmpty = conversations.filter((c) => (c.chat_messages ?? []).some((m) => extractMessageText(m).length > 0));
    let bucketProjectId: string | null = null;
    let artifactsImported = 0;
    // Claude artifact ids are only unique within a conversation (a generic
    // id like "app" could recur across unrelated chats), so lineage tracking
    // is keyed by conversation uuid + artifact id, not the id alone.
    const artifactLineages = new Map<string, { id: string; version: number }>();

    if (nonEmpty.length > 0) {
      const dateLabel = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
      const bucket = createProject({
        name: `Claude — Conversations — ${dateLabel}`,
        tagline: `${nonEmpty.length} conversation(s) imported from a Claude account export`,
      });
      bucketProjectId = bucket.id;
      projectIds.push(bucket.id);

      for (const conv of nonEmpty) {
        const convId = newId("conv");
        const convTs = conv.created_at || nowIso();
        const title = conv.name?.trim() || "Untitled";
        db.prepare(
          `INSERT INTO conversations (id, project_id, title, status, created_at, updated_at)
           VALUES (?, ?, ?, 'active', ?, ?)`
        ).run(convId, bucket.id, title, convTs, convTs);
        indexUpsert({ kind: "conversation", refId: convId, projectId: bucket.id, title, content: "", skipEmbedding: true });

        for (const m of conv.chat_messages ?? []) {
          const role = mapRole(m.sender);
          const text = extractMessageText(m);
          const artifacts = extractArtifactBlocks(m);

          let msgId: string | null = null;
          if (role && text) {
            msgId = newId("msg");
            const msgTs = m.created_at || convTs;
            db.prepare(
              `INSERT INTO messages (id, conversation_id, role, content, model, provenance, created_at)
               VALUES (?, ?, ?, ?, NULL, NULL, ?)`
            ).run(msgId, convId, role, text, msgTs);
            indexUpsert({
              kind: "message",
              refId: msgId,
              projectId: bucket.id,
              title: `${role} message in ${title}`,
              content: text,
              skipEmbedding: true,
            });
          }

          for (const art of artifacts) {
            const lineageKey = `${conv.uuid ?? convId}::${art.claudeId}`;
            const prior = artifactLineages.get(lineageKey);
            const artId = newId("art");
            const version = prior ? prior.version + 1 : 1;
            db.prepare(
              `INSERT INTO artifacts (id, project_id, conversation_id, message_id, title, type, content, version, parent_id, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            ).run(artId, bucket.id, convId, msgId, art.title, art.type, art.content, version, prior?.id ?? null, nowIso());
            indexUpsert({ kind: "artifact", refId: artId, projectId: bucket.id, title: art.title, content: art.content, skipEmbedding: true });
            artifactLineages.set(lineageKey, { id: artId, version });
            artifactsImported++;
          }
        }
      }
    }

    return {
      projectsCreated: projectIds.length,
      conversationsImported: nonEmpty.length,
      conversationsSkippedEmpty: conversations.length - nonEmpty.length,
      documentsImported,
      artifactsImported,
      memoryItemsImported,
      bucketProjectId,
      projectIds,
    };
  })();
}
