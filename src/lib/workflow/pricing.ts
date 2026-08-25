export type ResourceTier = "frontier" | "near-frontier" | "non-frontier";

export interface TierPricing {
  tier: ResourceTier;
  /** USD per 1,000,000 input tokens. */
  inputPerMillion: number;
  /** USD per 1,000,000 output tokens. */
  outputPerMillion: number;
}

/**
 * Directionally-realistic default pricing across three tiers (roughly
 * frontier / mid / small model class price ratios). These are illustrative
 * defaults for the calculator, not a claim about any specific vendor's
 * price list — callers should override with real, current pricing before
 * trusting an absolute dollar figure. See PLAN.md's non-goal: "No claim of
 * exact 90% savings without being able to compute it from real trace data."
 */
export const DEFAULT_PRICING: Record<ResourceTier, TierPricing> = {
  frontier: { tier: "frontier", inputPerMillion: 15, outputPerMillion: 75 },
  "near-frontier": { tier: "near-frontier", inputPerMillion: 3, outputPerMillion: 15 },
  "non-frontier": { tier: "non-frontier", inputPerMillion: 0.25, outputPerMillion: 1.25 },
};

export function priceTokens(
  tier: ResourceTier,
  inputTokens: number,
  outputTokens: number,
  pricing: Record<ResourceTier, TierPricing> = DEFAULT_PRICING,
): number {
  const p = pricing[tier];
  return (inputTokens / 1_000_000) * p.inputPerMillion + (outputTokens / 1_000_000) * p.outputPerMillion;
}

/** Maps a free-form observed model name to a pricing tier, defaulting to "frontier" (the conservative/worst-case assumption for unrecognized names). */
export function resolveTier(model: string | undefined): ResourceTier {
  if (model === "near-frontier" || model === "non-frontier") return model;
  return "frontier";
}
