import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "../helpers/reset";
import { createProject } from "@/lib/repo/projects";
import { addMessage, createConversation } from "@/lib/repo/conversations";
import {
  clearSuggestedForConversation,
  createMemory,
  deleteMemory,
  listMemory,
  listMemoryForClosure,
  setMemoryStatus,
  updateMemory,
} from "@/lib/repo/memory";
import { createClosure } from "@/lib/repo/episodes";

beforeEach(resetDb);

describe("memory repo", () => {
  it("defaults to established and manual", () => {
    const item = createMemory({ scope: "global", content: "A fact." });
    expect(item.status).toBe("established");
    expect(item.source).toBe("manual");
    expect(item.project_id).toBeNull();
  });

  it("scopes project memory and ignores a projectId on a global item", () => {
    const project = createProject({ name: "P" });
    const scoped = createMemory({ scope: "project", projectId: project.id, content: "Project fact." });
    expect(scoped.project_id).toBe(project.id);
    const global = createMemory({ scope: "global", projectId: project.id, content: "Global fact." });
    expect(global.project_id).toBeNull();
  });

  it("records claim-level provenance", () => {
    const project = createProject({ name: "P" });
    const conversation = createConversation(project.id, "A talk");
    const message = addMessage({ conversationId: conversation.id, role: "assistant", content: "Something true." });
    const item = createMemory({
      scope: "project",
      projectId: project.id,
      content: "Something true.",
      sourceMessageId: message.id,
      sourceConversationId: conversation.id,
    });
    expect(item.source_message_id).toBe(message.id);
    expect(item.source_conversation_id).toBe(conversation.id);
  });

  it("promotes a suggestion to established", () => {
    const item = createMemory({ scope: "global", content: "Maybe.", status: "suggested" });
    expect(item.status).toBe("suggested");
    expect(setMemoryStatus(item.id, "established")?.status).toBe("established");
  });

  it("lists project memory alongside global, but not another project's", () => {
    const a = createProject({ name: "A" });
    const b = createProject({ name: "B" });
    createMemory({ scope: "global", content: "global" });
    createMemory({ scope: "project", projectId: a.id, content: "for A" });
    createMemory({ scope: "project", projectId: b.id, content: "for B" });
    const forA = listMemory({ projectId: a.id }).map((m) => m.content);
    expect(forA).toContain("global");
    expect(forA).toContain("for A");
    expect(forA).not.toContain("for B");
  });

  it("clears a conversation's un-kept suggestions and spares the kept ones", () => {
    const project = createProject({ name: "P" });
    const conversation = createConversation(project.id, "A talk");
    const closure = createClosure({
      conversationId: conversation.id,
      projectId: project.id,
      summary: "s",
      messageCount: 1,
      throughMessageId: null,
    });
    const kept = createMemory({ scope: "global", content: "kept", status: "suggested", closureId: closure.id });
    createMemory({ scope: "global", content: "dropped", status: "suggested", closureId: closure.id });
    setMemoryStatus(kept.id, "established");

    expect(listMemoryForClosure(closure.id)).toHaveLength(2);
    clearSuggestedForConversation(conversation.id);
    const remaining = listMemoryForClosure(closure.id);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].content).toBe("kept");
  });

  it("updates and deletes", () => {
    const item = createMemory({ scope: "global", content: "before" });
    expect(updateMemory(item.id, "after")?.content).toBe("after");
    deleteMemory(item.id);
    expect(listMemory().find((m) => m.id === item.id)).toBeUndefined();
  });
});
