import { getSetting, setSetting } from "@/lib/settings";
import { getOpenRouterCapabilities } from "@/lib/models/openrouter";
import { getChutesCapabilities } from "@/lib/models/chutes";
import type { TokenUsage } from "@/lib/models/types";

const ANTHROPIC_PRICING_KEY = "anthropic_pricing";

export interface AnthropicModelPrice {
  promptPerM: number;
  completionPerM: number;
}

// Anthropic has no live pricing endpoint (unlike OpenRouter's catalog), so
// rates aren't fetched or hardcoded — they're only ever what the user enters
// in Settings. Absent that, cost stays null rather than a guessed number.
export function getAnthropicPricing(): Record<string, AnthropicModelPrice> {
  const raw = getSetting(ANTHROPIC_PRICING_KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, AnthropicModelPrice>;
  } catch {
    return {};
  }
}

export function setAnthropicPricing(pricing: Record<string, AnthropicModelPrice>) {
  setSetting(ANTHROPIC_PRICING_KEY, JSON.stringify(pricing));
}

// Returns null whenever the rate isn't known, rather than fabricating a cost.
export function estimateCost(
  provider: "anthropic" | "openrouter" | "chutes",
  modelId: string,
  usage: TokenUsage
): number | null {
  if (provider === "openrouter" || provider === "chutes") {
    const caps = provider === "openrouter" ? getOpenRouterCapabilities(modelId) : getChutesCapabilities(modelId);
    // Loose nullish checks on purpose: a capabilities cache written before
    // these fields existed has them simply absent (undefined), not null —
    // both mean "unknown," never treat either as zero.
    if (!caps || caps.pricePerPromptToken == null || caps.pricePerCompletionToken == null) return null;
    return usage.promptTokens * caps.pricePerPromptToken + usage.completionTokens * caps.pricePerCompletionToken;
  }
  const rate = getAnthropicPricing()[modelId];
  if (!rate) return null;
  // Cached input isn't billed at the input rate: writing a cache entry costs
  // more than sending the tokens plainly, and reading one costs a fraction.
  // These are Anthropic's published multipliers for the default (5-minute)
  // cache lifetime. Usage with neither field set reduces to plain input
  // tokens at the plain rate, exactly as before caching existed.
  const cacheRead = usage.cacheReadTokens ?? 0;
  const cacheWrite = usage.cacheWriteTokens ?? 0;
  const uncached = Math.max(usage.promptTokens - cacheRead - cacheWrite, 0);
  const promptCost =
    (uncached * rate.promptPerM + cacheWrite * rate.promptPerM * 1.25 + cacheRead * rate.promptPerM * 0.1) / 1_000_000;
  return promptCost + (usage.completionTokens * rate.completionPerM) / 1_000_000;
}
