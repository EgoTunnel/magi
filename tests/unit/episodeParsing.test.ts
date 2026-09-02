import { describe, expect, it } from "vitest";
import { bullets, extractDelimited, parsePersonLine, splitSections } from "@/lib/episodeClose";

describe("splitSections", () => {
  // Regression: the original heading matcher used a pattern that tried to
  // anticipate markdown decoration, and "**Decisions:**" — colon *inside* the
  // bold markers — silently swallowed the whole section into the one above it.
  it.each([
    ["plain", "Decisions:"],
    ["bold with inner colon", "**Decisions:**"],
    ["bold with outer colon", "**Decisions**:"],
    ["heading", "## Decisions"],
    ["bold heading", "### **Decisions**"],
    ["no colon", "Decisions"],
    ["padded", "  Decisions:  "],
  ])("recognizes a %s heading", (_label, heading) => {
    const sections = splitSections(`Summary:\nA summary.\n\n${heading}\n- Ship on Friday.\n`);
    expect(sections["summary"]?.trim()).toBe("A summary.");
    expect(sections["decisions"]).toContain("Ship on Friday.");
  });

  it("keeps section content out of the preceding section", () => {
    const sections = splitSections("Summary:\nJust the summary.\n\nDecisions:\n- A decision.");
    expect(sections["summary"]).not.toContain("A decision.");
  });

  it("returns an empty object when no headings are present", () => {
    expect(splitSections("Just some prose with no headings at all.")).toEqual({});
  });
});

describe("extractDelimited", () => {
  // Regression: a reasoning model emitted its deliberation before the answer,
  // and it parsed as content — proposals like "Is that a decision? Not
  // exactly..." were stored as memory.
  it("keeps only what is between the markers", () => {
    const reply = "Let me think. Is this a decision? Maybe.\n<<<CLOSEOUT>>>\nSummary:\nReal content.\n<<<END>>>\nTrailing chatter.";
    const body = extractDelimited(reply);
    expect(body).toContain("Real content.");
    expect(body).not.toContain("Let me think");
    expect(body).not.toContain("Trailing chatter");
  });

  it("falls back to the whole reply when the model ignored the markers", () => {
    expect(extractDelimited("Summary:\nNo markers here.")).toBe("Summary:\nNo markers here.");
  });

  it("takes everything after the opening marker when the closing one is missing", () => {
    expect(extractDelimited("noise\n<<<CLOSEOUT>>>\nkept")).toContain("kept");
    expect(extractDelimited("noise\n<<<CLOSEOUT>>>\nkept")).not.toContain("noise");
  });
});

describe("bullets", () => {
  it("accepts every bullet marker a model reaches for", () => {
    expect(bullets("- one\n* two\n• three\n1. four\n2) five")).toEqual([
      "one",
      "two",
      "three",
      "four",
      "five",
    ]);
  });

  it("drops the 'None.' a model writes for an empty section", () => {
    expect(bullets("None.")).toEqual([]);
    expect(bullets("none")).toEqual([]);
    expect(bullets("- None.")).toEqual([]);
  });

  it("strips wrapping quotes so they never reach stored memory", () => {
    expect(bullets('- "The session is on Sept 21."')).toEqual(["The session is on Sept 21."]);
    expect(bullets("- “Curly quotes too.”")).toEqual(["Curly quotes too."]);
  });

  it("normalizes a bold lead-in into plain text", () => {
    expect(bullets("- **Format**: one live session")).toEqual(["Format: one live session"]);
  });

  it("returns nothing for an absent or empty section", () => {
    expect(bullets(undefined)).toEqual([]);
    expect(bullets("   \n  ")).toEqual([]);
  });
});

describe("parsePersonLine", () => {
  it.each([
    ["em dash", "Keith — cares about accessibility."],
    ["en dash", "Keith – cares about accessibility."],
    ["hyphen", "Keith - cares about accessibility."],
    ["colon", "Keith: cares about accessibility."],
  ])("splits a name from what was learned, with an %s", (_label, line) => {
    expect(parsePersonLine(line)).toEqual({ name: "Keith", fact: "cares about accessibility." });
  });

  it("keeps a hyphenated name intact", () => {
    expect(parsePersonLine("Anne-Marie — runs the studio.")).toEqual({
      name: "Anne-Marie",
      fact: "runs the studio.",
    });
  });

  it("accepts a bare name with nothing learned", () => {
    expect(parsePersonLine("Syl")).toEqual({ name: "Syl", fact: null });
  });

  // A model that ignored the format must not turn a sentence into a person
  // named after the sentence — junk in a rolodex costs the user cleanup, which
  // is worse than the miss.
  it("refuses a sentence with no separator", () => {
    expect(parsePersonLine("The team discussed the review process at some length.")).toBeNull();
    expect(parsePersonLine("Nobody in particular was mentioned in this conversation at all")).toBeNull();
  });

  it("refuses a line whose name half is implausibly long", () => {
    expect(parsePersonLine(`${"a".repeat(80)} — said something`)).toBeNull();
  });

  it("ignores blank lines", () => {
    expect(parsePersonLine("   ")).toBeNull();
  });
});
