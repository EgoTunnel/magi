import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { contentLength, markCacheBreakpoint, systemParam, usageOf } from "@/lib/models/anthropic";
import { estimateCost, setAnthropicPricing } from "@/lib/models/pricing";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { markOpenRouterCacheBreakpoints, openRouterUsage } from "@/lib/models/openrouter";
import { setSetting } from "@/lib/settings";
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

describe("prompt caching through OpenRouter", () => {
  const long = "x".repeat(20000);
  const conversation = (): ChatCompletionMessageParam[] => [
    { role: "system", content: long },
    { role: "user", content: long },
    { role: "assistant", content: "An earlier answer." },
    { role: "user", content: "The live question." },
  ];

  it("marks the system prompt and the end of the history for a Claude model", () => {
    const working = conversation();
    markOpenRouterCacheBreakpoints(working, "anthropic/claude-sonnet-5");
    expect(working[0].content).toEqual([{ type: "text", text: long, cache_control: { type: "ephemeral" } }]);
    expect(working[2].content).toEqual([
      { type: "text", text: "An earlier answer.", cache_control: { type: "ephemeral" } },
    ]);
    // The live message changes every turn; marking it would only ever miss.
    expect(working[3].content).toBe("The live question.");
    expect(working[1].content).toBe(long);
  });

  it("leaves models that cache on their own untouched", () => {
    const working = conversation();
    markOpenRouterCacheBreakpoints(working, "deepseek/deepseek-v4-pro");
    expect(working).toEqual(conversation());
  });

  it("leaves a conversation too short to be worth caching unmarked", () => {
    const working: ChatCompletionMessageParam[] = [
      { role: "system", content: "Short." },
      { role: "user", content: "Hi" },
      { role: "assistant", content: "Hello" },
      { role: "user", content: "Now what?" },
    ];
    markOpenRouterCacheBreakpoints(working, "anthropic/claude-sonnet-5");
    expect(working[0].content).toBe("Short.");
    expect(working[2].content).toBe("Hello");
  });

  it("reports cache hits and writes from OpenRouter's usage", () => {
    expect(
      openRouterUsage({
        prompt_tokens: 5000,
        completion_tokens: 40,
        total_tokens: 5040,
        prompt_tokens_details: { cached_tokens: 4500, cache_write_tokens: 0 } as never,
      })
    ).toEqual({ promptTokens: 5000, completionTokens: 40, cacheReadTokens: 4500 });
    expect(openRouterUsage({ prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 })).toEqual({
      promptTokens: 10,
      completionTokens: 2,
    });
  });

  it("prices cached input at the catalog's cache rate when it lists one", () => {
    resetDb();
    setSetting(
      "openrouter_capabilities_cache",
      JSON.stringify({
        "anthropic/claude-sonnet-5": {
          supportsTools: true,
          reasoningMandatory: false,
          reasoningEfforts: [],
          maxCompletionTokens: null,
          pricePerPromptToken: 0.000003,
          pricePerCompletionToken: 0.000015,
          pricePerCacheReadToken: 0.0000003,
          pricePerCacheWriteToken: 0.00000375,
        },
        "old/model": {
          supportsTools: true,
          reasoningMandatory: false,
          reasoningEfforts: [],
          maxCompletionTokens: null,
          pricePerPromptToken: 0.000003,
          pricePerCompletionToken: 0.000015,
        },
      })
    );
    const usageWithHit = { promptTokens: 10000, completionTokens: 0, cacheReadTokens: 10000 };
    expect(estimateCost("openrouter", "anthropic/claude-sonnet-5", usageWithHit)).toBeCloseTo(0.003, 6);
    // A capabilities cache from before cache rates were read prices it all
    // at the plain rate, as before.
    expect(estimateCost("openrouter", "old/model", usageWithHit)).toBeCloseTo(0.03, 6);
  });
});
