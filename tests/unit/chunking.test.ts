import { describe, expect, it } from "vitest";
import { chunkText } from "@/lib/chunking";

describe("chunkText", () => {
  it("returns nothing for empty or whitespace-only text", () => {
    expect(chunkText("")).toEqual([]);
    expect(chunkText("   \n\n  ")).toEqual([]);
  });

  it("keeps short text as a single chunk", () => {
    const chunks = chunkText("A short note about printers.");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toEqual({ index: 0, content: "A short note about printers." });
  });

  it("packs paragraphs together rather than emitting one chunk per paragraph", () => {
    const text = Array.from({ length: 6 }, (_, i) => `Paragraph ${i} ${"x".repeat(100)}`).join("\n\n");
    const chunks = chunkText(text);
    expect(chunks.length).toBeLessThan(6);
    expect(chunks.length).toBeGreaterThan(0);
  });

  it("splits an over-long single paragraph and indexes chunks in order", () => {
    const chunks = chunkText("word ".repeat(2000));
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.map((c) => c.index)).toEqual(chunks.map((_, i) => i));
  });

  it("keeps chunks near the target size", () => {
    const text = Array.from({ length: 40 }, (_, i) => `Para ${i}. ${"lorem ipsum ".repeat(20)}`).join("\n\n");
    const lengths = chunkText(text).map((c) => c.content.length);
    // The ceiling is soft: a short trailing chunk is folded back into the one
    // before it, which can push a single chunk past the target.
    expect(Math.max(...lengths)).toBeLessThan(1600);
  });

  it("does not lose the beginning or end of the text", () => {
    const text = `FIRST_MARKER\n\n${"filler paragraph. ".repeat(300)}\n\nLAST_MARKER`;
    const joined = chunkText(text).map((c) => c.content).join("\n");
    expect(joined).toContain("FIRST_MARKER");
    expect(joined).toContain("LAST_MARKER");
  });

  it("does not emit empty chunks", () => {
    const text = "One.\n\n\n\n\n\nTwo.\n\n\n\n" + "z".repeat(3000);
    expect(chunkText(text).every((c) => c.content.trim().length > 0)).toBe(true);
  });
});
