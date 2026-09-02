import { db, newId, nowIso } from "@/lib/db";
import { indexUpsert } from "@/lib/searchIndex";
import { createProject, getProject } from "@/lib/repo/projects";
import { listConversations, listMessages } from "@/lib/repo/conversations";
import { listMemory } from "@/lib/repo/memory";
import { listDocuments } from "@/lib/repo/documents";
import { listArtifacts, listVersions } from "@/lib/repo/artifacts";
import { listSkills } from "@/lib/repo/skills";

// The portable, provider-neutral shape of a Project. This is the whole point
// of §62 in the Product Vision: the user's accumulated environment should
// not be held hostage by this application. Every field here is plain data —
// no database ids, no internal references — so it can outlive this specific
// Magi install.
export interface ExportBundle {
  magiExportVersion: 1;
  exportedAt: string;
  project: {
    name: string;
    tagline: string | null;
    purpose: string | null;
    instructions: string | null;
  };
  conversations: {
    title: string;
    createdAt: string;
    messages: { role: string; content: string; model: string | null; createdAt: string }[];
  }[];
  memory: { content: string; createdAt: string }[];
  documents: { title: string; content: string; createdAt: string }[];
  artifacts: {
    title: string;
    type: string;
    versions: { version: number; content: string; createdAt: string }[];
  }[];
  skills: { name: string; description: string | null; instructions: string; createdAt: string }[];
}

export function exportProject(projectId: string): ExportBundle {
  const project = getProject(projectId);
  if (!project) throw new Error("Project not found");

  const conversations = listConversations(projectId).map((c) => ({
    title: c.title,
    createdAt: c.created_at,
    messages: listMessages(c.id).map((m) => ({
      role: m.role,
      content: m.content,
      model: m.model,
      createdAt: m.created_at,
    })),
  }));

  // Project-scoped memory only — and deliberately no people. A person is
  // global and crosses Projects, while a Project export is a file meant to be
  // shared; shipping what the user knows about third parties inside it would
  // be a privacy leak dressed up as portability. Someone who wants a person's
  // record can export that person on their own page. The `scope === 'project'`
  // filter is what enforces it, since a person's facts are memory rows.
  const memory = listMemory({ projectId })
    .filter((m) => m.scope === "project")
    .map((m) => ({ content: m.content, createdAt: m.created_at }));

  const documents = listDocuments(projectId).map((d) => ({
    title: d.title,
    content: d.content,
    createdAt: d.created_at,
  }));

  const artifacts = listArtifacts(projectId).map((a) => ({
    title: a.title,
    type: a.type,
    versions: listVersions(a.id).map((v) => ({ version: v.version, content: v.content, createdAt: v.created_at })),
  }));

  const skills = listSkills({ projectId })
    .filter((s) => s.scope === "project")
    .map((s) => ({ name: s.name, description: s.description, instructions: s.instructions, createdAt: s.created_at }));

  return {
    magiExportVersion: 1,
    exportedAt: nowIso(),
    project: {
      name: project.name,
      tagline: project.tagline,
      purpose: project.purpose,
      instructions: project.instructions,
    },
    conversations,
    memory,
    documents,
    artifacts,
    skills,
  };
}

// Import always creates a fresh Project with newly minted ids — never
// reuses ids from the export, so it's always safe to import into the same
// Magi install the export came from, or a different one entirely.
//
// Wrapped in one transaction: atomic (no half-imported Project left behind
// on failure partway through) and, at real scale — a foreign chat export can
// be thousands of messages — dramatically faster than better-sqlite3's
// default of one implicit transaction per INSERT.
//
// Every indexUpsert() below passes skipEmbedding: true. Without it, a large
// import would fire one background embedding request per message — for a
// foreign export that's potentially tens of thousands of concurrent,
// unthrottled requests at OpenRouter. Use the Settings "Build index" backfill
// afterward instead; it's already batched and rate-limited for exactly this.
export function importProject(bundle: ExportBundle): { id: string } {
  return db.transaction(() => {
    const project = createProject({
      name: bundle.project.name,
      tagline: bundle.project.tagline ?? undefined,
      purpose: bundle.project.purpose ?? undefined,
      instructions: bundle.project.instructions ?? undefined,
    });

    for (const conv of bundle.conversations ?? []) {
      const convId = newId("conv");
      const ts = conv.createdAt || nowIso();
      db.prepare(
        `INSERT INTO conversations (id, project_id, title, status, created_at, updated_at)
         VALUES (?, ?, ?, 'active', ?, ?)`
      ).run(convId, project.id, conv.title, ts, ts);
      indexUpsert({ kind: "conversation", refId: convId, projectId: project.id, title: conv.title, content: "", skipEmbedding: true });

      for (const m of conv.messages ?? []) {
        const msgId = newId("msg");
        const msgTs = m.createdAt || ts;
        db.prepare(
          `INSERT INTO messages (id, conversation_id, role, content, model, provenance, created_at)
           VALUES (?, ?, ?, ?, ?, NULL, ?)`
        ).run(msgId, convId, m.role, m.content, m.model, msgTs);
        indexUpsert({
          kind: "message",
          refId: msgId,
          projectId: project.id,
          title: `${m.role} message in ${conv.title}`,
          content: m.content,
          sourceDate: msgTs,
          skipEmbedding: true,
        });
      }
    }

    for (const mem of bundle.memory ?? []) {
      const id = newId("mem");
      db.prepare(
        `INSERT INTO memory (id, scope, project_id, content, source, status, created_at)
         VALUES (?, 'project', ?, ?, 'import', 'established', ?)`
      ).run(id, project.id, mem.content, mem.createdAt || nowIso());
      indexUpsert({ kind: "memory", refId: id, projectId: project.id, title: "project memory", content: mem.content, skipEmbedding: true });
    }

    for (const doc of bundle.documents ?? []) {
      const id = newId("doc");
      const ts = doc.createdAt || nowIso();
      db.prepare(
        `INSERT INTO documents (id, project_id, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`
      ).run(id, project.id, doc.title, doc.content, ts, ts);
      indexUpsert({ kind: "document", refId: id, projectId: project.id, title: doc.title, content: doc.content, sourceDate: ts, skipEmbedding: true });
    }

    for (const art of bundle.artifacts ?? []) {
      let parentId: string | null = null;
      const versions = [...(art.versions ?? [])].sort((a, b) => a.version - b.version);
      for (const v of versions) {
        const id = newId("art");
        db.prepare(
          `INSERT INTO artifacts (id, project_id, conversation_id, title, type, content, version, parent_id, created_at)
           VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?)`
        ).run(id, project.id, art.title, art.type, v.content, v.version, parentId, v.createdAt || nowIso());
        if (v === versions[versions.length - 1]) {
          indexUpsert({ kind: "artifact", refId: id, projectId: project.id, title: art.title, content: v.content, skipEmbedding: true });
        }
        parentId = id;
      }
    }

    for (const skill of bundle.skills ?? []) {
      const id = newId("skl");
      db.prepare(
        `INSERT INTO skills (id, scope, project_id, name, description, instructions, created_at)
         VALUES (?, 'project', ?, ?, ?, ?, ?)`
      ).run(id, project.id, skill.name, skill.description, skill.instructions, skill.createdAt || nowIso());
      indexUpsert({
        kind: "skill",
        refId: id,
        projectId: project.id,
        title: skill.name,
        content: `${skill.description ?? ""}\n${skill.instructions}`,
        skipEmbedding: true,
      });
    }

    return { id: project.id };
  })();
}
