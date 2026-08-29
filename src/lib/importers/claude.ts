import type { ExportBundle } from "@/lib/portability";

// Shape confirmed against multiple independent parsers built against real
// Claude.ai data exports (Anthropic doesn't publish a formal spec either) —
// text extraction falls back to structured content blocks since some export
// snapshots use content[] instead of a flat text field.
interface ClaudeContentBlock {
  type?: string;
  text?: string;
}
interface ClaudeMessage {
  sender?: string;
  text?: string;
  content?: ClaudeContentBlock[];
  created_at?: string;
}
interface ClaudeConversation {
  name?: string;
  created_at?: string;
  chat_messages?: ClaudeMessage[];
}

function extractText(msg: ClaudeMessage): string {
  if (msg.text && msg.text.trim()) return msg.text.trim();
  if (Array.isArray(msg.content)) {
    return msg.content
      .filter((b): b is ClaudeContentBlock & { text: string } => b.type === "text" && typeof b.text === "string" && b.text.trim().length > 0)
      .map((b) => b.text.trim())
      .join("\n\n");
  }
  return "";
}

function mapRole(sender: string | undefined): "user" | "assistant" | null {
  if (sender === "human") return "user";
  if (sender === "assistant") return "assistant";
  return null; // pure tool-use/tool-result turns have no Magi equivalent
}

function convertConversation(conv: ClaudeConversation): ExportBundle["conversations"][number] {
  const messages: ExportBundle["conversations"][number]["messages"] = [];
  for (const m of conv.chat_messages ?? []) {
    const role = mapRole(m.sender);
    if (!role) continue;
    const text = extractText(m);
    if (!text) continue;
    messages.push({ role, content: text, model: null, createdAt: m.created_at || new Date().toISOString() });
  }
  return {
    title: conv.name?.trim() || "Untitled",
    createdAt: conv.created_at || new Date().toISOString(),
    messages,
  };
}

export function fromClaudeExport(raw: unknown): ExportBundle {
  const conversations = Array.isArray(raw) ? (raw as ClaudeConversation[]) : [];
  const dateLabel = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const converted = conversations.map(convertConversation).filter((c) => c.messages.length > 0);
  return {
    magiExportVersion: 1,
    exportedAt: new Date().toISOString(),
    project: {
      name: `Imported from Claude — ${dateLabel}`,
      tagline: `${converted.length} conversation(s) imported from a Claude data export`,
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
