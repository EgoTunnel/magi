import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { contentLength, markCacheBreakpoint, systemParam, usageOf } from "@/lib/models/anthropic";
import { estimateCost, setAnthropicPricing } from "@/lib/models/pricing";
import { resetDb } from "../helpers/reset";

const usage = (fields: Partial<Anthropic.Usage>): Anthropic.Usage =>
  ({ input_tokens: 0, output_tokens: 0, ...fields }) as Anthropic.Usage;

describe("cache breakpoints", () => {
  it("turns a plain string message into a marked block", () => {
    const message: Anthropic.MessageParam = { role: "user", content: "Earlier turn." };
    markCacheBreakpoint(message);
    expect(message.content).toEqual([
      { type: "text", text: "Earlier turn.", cache_control: { type: "ephemeral" } },
    ]);
  });

  it("marks the last block of a multimodal message, leaving the rest alone", () => {
    const message: Anthropic.MessageParam = {
      role: "user",
      content: [
        { type: "text", text: "Look at this" },
        { type: "text", text: "and this" },
      ],
    };
    markCacheBreakpoint(message);
    const blocks = message.content as Anthropic.TextBlockParam[];
    expect(blocks[0].cache_control).toBeUndefined();
    expect(blocks[1].cache_control).toEqual({ type: "ephemeral" });
  });

  // An empty text block is rejected by the API outright, so a message with no
  // text to mark has to be left as it is — a missed cache, not a failed turn.
  it("leaves an empty message unmarked rather than sending an empty block", () => {
    const message: Anthropic.MessageParam = { role: "user", content: "" };
    markCacheBreakpoint(message);
    expect(message.content).toBe("");
  });

  it("only marks a system prompt worth caching", () => {
    expect(systemParam("short", true)).toBe("short");
    expect(systemParam(undefined, true)).toBeUndefined();
    const long = "x".repeat(20000);
    expect(systemParam(long, true)).toEqual([
      { type: "text", text: long, cache_control: { type: "ephemeral" } },
    ]);
    // Nothing is marked when the caller didn't ask for caching.
    expect(systemParam(long, false)).toBe(long);
  });

  it("measures only the text of a message, not its images", () => {
    expect(contentLength("abcd")).toBe(4);
    expect(
      contentLength([
        { type: "text", text: "abc" },
        { type: "image", source: { type: "base64", media_type: "image/png", data: "x".repeat(500) } },
      ])
    ).toBe(3);
  });
});

describe("cached token accounting", () => {
  it("counts cached input as input, and reports the split", () => {
    expect(usageOf(usage({ input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 4000 }))).toEqual({
      promptTokens: 4100,
      completionTokens: 20,
      cacheReadTokens: 4000,
      cacheWriteTokens: 0,
    });
  });

  it("prices a cache hit far below the same tokens sent fresh", () => {
    resetDb();
    setAnthropicPricing({ "claude-sonnet-5": { promptPerM: 3, completionPerM: 15 } });

    const fresh = estimateCost("anthropic", "claude-sonnet-5", { promptTokens: 10000, completionTokens: 0 });
    const cached = estimateCost("anthropic", "claude-sonnet-5", {
      promptTokens: 10000,
      completionTokens: 0,
      cacheReadTokens: 10000,
    });
    const written = estimateCost("anthropic", "claude-sonnet-5", {
      promptTokens: 10000,
      completionTokens: 0,
      cacheWriteTokens: 10000,
    });

    expect(fresh).toBeCloseTo(0.03, 6);
    expect(cached).toBeCloseTo(0.003, 6);
    expect(written).toBeCloseTo(0.0375, 6);
  });

  it("prices usage with no cache fields exactly as it always did", () => {
    resetDb();
    setAnthropicPricing({ "claude-sonnet-5": { promptPerM: 3, completionPerM: 15 } });
    expect(estimateCost("anthropic", "claude-sonnet-5", { promptTokens: 1000, completionTokens: 1000 })).toBeCloseTo(
      0.018,
      6
    );
  });
});
