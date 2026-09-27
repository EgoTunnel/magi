import { describe, expect, it } from "vitest";
import { splitStreamingMarkdown } from "@/lib/streamingMarkdown";

describe("splitStreamingMarkdown", () => {
  it("treats a reply with no finished block as all tail", () => {
    expect(splitStreamingMarkdown("Hello, wor")).toEqual({ stable: "", tail: "Hello, wor" });
  });

  it("splits at the last blank line", () => {
    expect(splitStreamingMarkdown("# Title\n\nFirst para.\n\nSecond, still go")).toEqual({
      stable: "# Title\n\nFirst para.",
      tail: "Second, still go",
    });
  });

  it("never splits inside an open code fence", () => {
    const text = "Intro.\n\n```ts\nconst a = 1;\n\nconst b = 2;";
    expect(splitStreamingMarkdown(text)).toEqual({ stable: "Intro.", tail: "```ts\nconst a = 1;\n\nconst b = 2;" });
  });

  it("splits after a code fence once it has closed", () => {
    const text = "```\ncode\n\nmore\n```\n\nAfter the fence";
    expect(splitStreamingMarkdown(text)).toEqual({ stable: "```\ncode\n\nmore\n```", tail: "After the fence" });
  });

  it("reassembles to the original text", () => {
    const text = "a\n\nb\n\n```\nc\n\nd\n```\n\ne";
    const { stable, tail } = splitStreamingMarkdown(text);
    expect(stable ? `${stable}\n\n${tail}` : tail).toBe(text);
  });
});
