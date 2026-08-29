// Structural detection, not a file-extension or vendor-labeled check —
// "mapping" + "current_node" and "chat_messages" are distinctive, load-
// bearing field names unique to each format, not a guess.
export function detectForeignFormat(raw: unknown): "chatgpt" | "claude" | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const first = raw[0];
  if (!first || typeof first !== "object") return null;
  if ("mapping" in first && "current_node" in first) return "chatgpt";
  if ("chat_messages" in first) return "claude";
  return null;
}
