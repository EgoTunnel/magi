import { describe, expect, it } from "vitest";
import { splitWindow } from "@/lib/conversationWindow";
import type { Message } from "@/lib/repo/conversations";

function messages(count: number, size: number): Message[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `m${i}`,
    conversation_id: "c",
    role: (i % 2 === 0 ? "user" : "assistant") as Message["role"],
    content: "x".repeat(size),
    model: null,
    provenance: null,
    created_at: "2026-01-01T00:00:00.000Z",
  }));
}

const chars = (list: Message[]) => list.reduce((n, m) => n + m.content.length, 0);

describe("splitWindow", () => {
  it("summarizes nothing for an ordinary conversation", () => {
    const { older, window } = splitWindow(messages(8, 500));
    expect(older).toHaveLength(0);
    expect(window).toHaveLength(8);
  });

  it("keeps a recent window and ages out the rest of a long one", () => {
    const { older, window } = splitWindow(messages(200, 2000));
    expect(older.length).toBeGreaterThan(0);
    expect(chars(window)).toBeLessThanOrEqual(40000);
    // The window is the *tail* — regenerating the last reply must not have
    // summarized away the thing being regenerated.
    expect(window[window.length - 1].id).toBe("m199");
  });

  it("never drops below the message floor, however large the messages are", () => {
    const { window } = splitWindow(messages(10, 200000));
    expect(window.length).toBeGreaterThanOrEqual(6);
  });

  it("splits into two contiguous halves that reconstruct the original", () => {
    const all = messages(50, 3000);
    const { older, window } = splitWindow(all);
    expect([...older, ...window].map((m) => m.id)).toEqual(all.map((m) => m.id));
  });

  it("handles the degenerate cases", () => {
    expect(splitWindow([])).toEqual({ older: [], window: [] });
    const one = splitWindow(messages(1, 100));
    expect(one.older).toHaveLength(0);
    expect(one.window).toHaveLength(1);
  });
});
