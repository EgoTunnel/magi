import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "../helpers/reset";
import { setSetting } from "@/lib/settings";
import { __setProvidersForTests, getRoleAssignments } from "@/lib/models/registry";
import type { ModelInfo, ModelProvider } from "@/lib/models/types";

// Mirrors the private key in src/lib/models/openrouter.ts — there's no
// exported constant, and duplicating the literal here is cheaper than
// exporting one just for this test.
const CAPABILITIES_CACHE_KEY = "openrouter_capabilities_cache";

function fakeProvider(models: ModelInfo[]): ModelProvider {
  return {
    id: "openrouter",
    label: "Fake",
    models,
    isConfigured: () => true,
    complete: async () => "",
    async *stream() {},
  };
}

function model(id: string, speed: ModelInfo["speed"]): ModelInfo {
  return { id, provider: "openrouter", label: id, description: "", speed, supportsTools: true, supportsVision: true };
}

beforeEach(resetDb);

describe("pickDefaultModel — fast role", () => {
  // "fast" backs short, often shape-constrained turns (the role classifier,
  // the conversation-summary fold) — exactly the workload a mandatory-reasoning
  // model is worst at, since it spends the tight budget on hidden deliberation
  // before any visible answer (see docs/Handoff.md, People — review pass, and
  // lesson #9). speed is guessed purely from the model id ("flash", "mini",
  // "8b", ...) with no awareness of that flag, so a mandatory-reasoning model
  // named "…-flash" used to win by being first in the list.
  it("prefers a non-mandatory-reasoning model among same-speed candidates", () => {
    const mandatory = model("some-vendor/mandatory-flash", "fast");
    const clean = model("some-vendor/clean-flash", "fast");
    const restore = __setProvidersForTests([fakeProvider([mandatory, clean])]);
    setSetting(
      CAPABILITIES_CACHE_KEY,
      JSON.stringify({
        [mandatory.id]: { supportsTools: true, reasoningMandatory: true, reasoningEfforts: ["low"], maxCompletionTokens: null, pricePerPromptToken: null, pricePerCompletionToken: null },
        [clean.id]: { supportsTools: true, reasoningMandatory: false, reasoningEfforts: ["low"], maxCompletionTokens: null, pricePerPromptToken: null, pricePerCompletionToken: null },
      })
    );

    expect(getRoleAssignments().fast).toBe(clean.id);
    restore();
  });

  it("still picks the mandatory-reasoning model when it's the only fast candidate", () => {
    const onlyOption = model("some-vendor/only-flash", "fast");
    const restore = __setProvidersForTests([fakeProvider([onlyOption])]);
    setSetting(
      CAPABILITIES_CACHE_KEY,
      JSON.stringify({
        [onlyOption.id]: { supportsTools: true, reasoningMandatory: true, reasoningEfforts: ["low"], maxCompletionTokens: null, pricePerPromptToken: null, pricePerCompletionToken: null },
      })
    );

    // A model that can't do the job well is still better than none at all —
    // this is a preference among candidates, not a hard exclusion.
    expect(getRoleAssignments().fast).toBe(onlyOption.id);
    restore();
  });

  // Anthropic models (and any OpenRouter model whose capabilities haven't
  // been fetched yet) have no cached capabilities entry at all. Fail open,
  // the same posture requestExtras() already takes for the same missing-data
  // case — an unknown model is not assumed to be a mandatory-reasoning trap.
  it("treats a model with no cached capabilities as fine, not as mandatory", () => {
    const uncached = model("anthropic/claude-haiku-4-5", "fast");
    const restore = __setProvidersForTests([fakeProvider([uncached])]);
    // No capabilities cache written at all.
    expect(getRoleAssignments().fast).toBe(uncached.id);
    restore();
  });
});
