import { describe, expect, it } from "vitest";
import {
  computeMatrixTotals,
  expectedScore,
  normalizeConsensus,
  readMatrixInput,
  readModelScores,
  sectionsByOption,
} from "@/lib/councilJudgment";
import type { MatrixCell, MatrixCriterion } from "@/lib/repo/councils";

describe("normalizeConsensus", () => {
  it("reads the level out of whatever the Synthesizer wrote around it", () => {
    expect(normalizeConsensus("Moderate")).toBe("Moderate");
    expect(normalizeConsensus("**Strong** — all three agree")).toBe("Strong");
    expect(normalizeConsensus("none")).toBe("None");
    expect(normalizeConsensus("Unspecified")).toBeNull();
    expect(normalizeConsensus(null)).toBeNull();
  });
});

describe("sectionsByOption", () => {
  const text = [
    "Some preamble.",
    "### Postgres",
    "Mature, strong on reporting.",
    "### SQLite",
    "Simple; one file.",
    "## Summary",
    "Both fine.",
  ].join("\n");

  it("gives each option the section under its own heading", () => {
    const sections = sectionsByOption(text, ["Postgres", "SQLite"]);
    expect(sections.Postgres).toBe("Mature, strong on reporting.");
    expect(sections.SQLite).toContain("Simple; one file.");
  });

  it("falls back to the whole assessment when an option has no heading", () => {
    const sections = sectionsByOption(text, ["Postgres", "DynamoDB"]);
    expect(sections.DynamoDB).toBe(text);
  });

  it("tolerates 'Option 1:' prefixes, bold, and names with regex characters", () => {
    const sections = sectionsByOption("## Option 1: **C++ (native)**\nFast.\n## Option 2: Go\nSimple.", ["C++ (native)", "Go"]);
    expect(sections["C++ (native)"]).toBe("Fast.");
    expect(sections.Go).toBe("Simple.");
  });
});

describe("expectedScore", () => {
  it("maps a sure level straight onto 0-10", () => {
    expect(expectedScore(4)).toBe(10);
    expect(expectedScore(0)).toBe(0);
    expect(expectedScore(2)).toBe(5);
  });

  // An uncertain "Good" should count for less than a certain one.
  it("averages over the distribution when there is one", () => {
    const sure = expectedScore(3, { Good: 1 });
    const unsure = expectedScore(3, { Good: 0.55, Fair: 0.45 });
    expect(sure).toBe(7.5);
    expect(unsure).toBeLessThan(sure);
    expect(unsure).toBeCloseTo(((0.55 * 3 + 0.45 * 2) / 4) * 10, 5);
  });
});

describe("computeMatrixTotals", () => {
  const cell = (option: string, criterion: string, expected: number): MatrixCell => ({
    option,
    criterion,
    label: "",
    level: 0,
    expected,
  });

  it("weights, ranks, and finds what the ranking turns on", () => {
    const criteria: MatrixCriterion[] = [
      { name: "Cost", weight: 5 },
      { name: "Speed", weight: 1 },
    ];
    const cells = [cell("A", "Cost", 10), cell("A", "Speed", 0), cell("B", "Cost", 2), cell("B", "Speed", 10)];
    const { totals, decisiveCriteria } = computeMatrixTotals(["A", "B"], criteria, cells);
    // A: (10*5 + 0*1)/6 = 8.3; B: (2*5 + 10*1)/6 = 3.3
    expect(totals).toEqual([
      { option: "A", score: 8.3 },
      { option: "B", score: 3.3 },
    ]);
    // Without Cost, B would win; without Speed, A still does.
    expect(decisiveCriteria).toEqual(["Cost"]);
  });

  it("reports nothing decisive when the leader wins on every criterion", () => {
    const criteria: MatrixCriterion[] = [
      { name: "Cost", weight: 3 },
      { name: "Speed", weight: 3 },
    ];
    const cells = [cell("A", "Cost", 9), cell("A", "Speed", 9), cell("B", "Cost", 3), cell("B", "Speed", 3)];
    expect(computeMatrixTotals(["A", "B"], criteria, cells).decisiveCriteria).toEqual([]);
  });
});

describe("readModelScores", () => {
  const criteria: MatrixCriterion[] = [{ name: "Cost", weight: 3 }];

  it("reads a complete grid, tolerating prose around the JSON", () => {
    const cells = readModelScores('Here you go:\n{"scores":{"A":{"Cost":"good"},"B":{"Cost":"Poor"}}}', ["A", "B"], criteria);
    expect(cells.map((c) => [c.option, c.label, c.expected])).toEqual([
      ["A", "Good", 7.5],
      ["B", "Poor", 2.5],
    ]);
  });

  it("refuses a grid with a missing option or an invented rating", () => {
    expect(() => readModelScores('{"scores":{"A":{"Cost":"Good"}}}', ["A", "B"], criteria)).toThrow(/left out "B"/);
    expect(() => readModelScores('{"scores":{"A":{"Cost":"7/10"},"B":{"Cost":"Good"}}}', ["A", "B"], criteria)).toThrow(
      /no valid rating/
    );
    expect(() => readModelScores("no json here", ["A"], criteria)).toThrow(/no JSON/);
  });
});

describe("readMatrixInput", () => {
  const criteria = [{ name: "Cost", weight: 3 }];

  it("accepts and trims a valid matrix", () => {
    expect(readMatrixInput({ options: [" A ", "B", ""], criteria })).toEqual({
      ok: true,
      matrix: { options: ["A", "B"], criteria },
    });
  });

  it("rejects too few options, duplicates, and out-of-range weights", () => {
    expect(readMatrixInput({ options: ["A"], criteria }).ok).toBe(false);
    expect(readMatrixInput({ options: ["A", "a"], criteria }).ok).toBe(false);
    expect(readMatrixInput({ options: ["A", "B"], criteria: [] }).ok).toBe(false);
    expect(readMatrixInput({ options: ["A", "B"], criteria: [{ name: "Cost", weight: 9 }] }).ok).toBe(false);
    expect(readMatrixInput({ options: ["A", "B"], criteria: [{ name: "Cost", weight: 2.5 }] }).ok).toBe(false);
  });
});
