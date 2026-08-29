import type { ExportBundle } from "@/lib/portability";

// Shape confirmed against OpenAI's own developer community and independent
// third-party parsers (no formal spec is published, and the shape has
// drifted over time) — kept deliberately loose/optional throughout rather
// than pinned to one exact snapshot.
interface ChatGPTNode {
  id?: string;
  message: {
    author?: { role?: string };
    content?: { content_type?: string; parts?: unknown[] };
    create_time?: number | null;
  } | null;
  parent?: string | null;
  children?: string[];
}

interface ChatGPTConversation {
  title?: string;
  create_time?: number;
  current_node?: string;
  mapping?: Record<string, ChatGPTNode>;
}

function toIso(unixSeconds: number | null | undefined): string {
  if (!unixSeconds) return new Date().toISOString();
  return new Date(unixSeconds * 1000).toISOString();
}

function extractText(parts: unknown[] | undefined): string {
  if (!parts) return "";
  return parts
    .filter((p): p is string => typeof p === "string")
    .join("\n")
    .trim();
}

// current_node marks the leaf of the currently-active branch — walking
// backward via parent is unambiguous by construction, unlike walking forward
// from the root, which would have to guess which sibling (of an edit or
// regeneration) was the one actually kept.
function activeMessageChain(conv: ChatGPTConversation): ChatGPTNode[] {
  const mapping = conv.mapping ?? {};
  const chain: ChatGPTNode[] = [];
  const seen = new Set<string>();
  let nodeId = conv.current_node;
  while (nodeId && mapping[nodeId] && !seen.has(nodeId)) {
    seen.add(nodeId);
    chain.push(mapping[nodeId]);
    nodeId = mapping[nodeId].parent ?? undefined;
  }
  return chain.reverse();
}

function convertConversation(conv: ChatGPTConversation): ExportBundle["conversations"][number] {
  const messages: ExportBundle["conversations"][number]["messages"] = [];
  for (const node of activeMessageChain(conv)) {
    const msg = node.message;
    if (!msg) continue; // structural placeholder node
    const role = msg.author?.role;
    // Tool/plugin/browsing nodes are skipped — their content is tool-call-
    // shaped JSON, not conversation text, and would just be noise here.
    if (role !== "user" && role !== "assistant") continue;
    const text = extractText(msg.content?.parts);
    if (!text) continue;
    messages.push({ role, content: text, model: null, createdAt: toIso(msg.create_time) });
  }
  return {
    title: conv.title?.trim() || "Untitled",
    createdAt: toIso(conv.create_time),
    messages,
  };
}

export function fromChatGPTExport(raw: unknown): ExportBundle {
  const conversations = Array.isArray(raw) ? (raw as ChatGPTConversation[]) : [];
  const dateLabel = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const converted = conversations.map(convertConversation).filter((c) => c.messages.length > 0);
  return {
    magiExportVersion: 1,
    exportedAt: new Date().toISOString(),
    project: {
      name: `Imported from ChatGPT — ${dateLabel}`,
      tagline: `${converted.length} conversation(s) imported from a ChatGPT data export`,
      purpose: null,
      instructions: null,
    },
    conversations: converted,
    memory: [],
    documents: [],
    artifacts: [],
    skills: [],
  };
}
