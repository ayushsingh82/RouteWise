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

const NON_FRONTIER_PATTERN = /haiku|mini|nano|flash|lite|small|instant|\b(1|3|7|8)b\b|gpt-3\.5/i;
const NEAR_FRONTIER_PATTERN = /sonnet|gpt-4o(?!-mini)|gpt-4\.1(?!-(mini|nano))|gpt-4-turbo|gemini-.*pro|-pro\b/i;

/**
 * Maps a free-form observed model name to a pricing tier. Tier names pass
 * through; well-known model families are matched by name pattern; anything
 * unrecognized defaults to "frontier" (the conservative/worst-case
 * assumption — it can only make the *current* spend look higher, never hide
 * a downgrade, and the report flags the assumption).
 */
export function resolveTier(model: string | undefined): ResourceTier {
  if (!model) return "frontier";
  if (model === "frontier" || model === "near-frontier" || model === "non-frontier") return model;
  if (NON_FRONTIER_PATTERN.test(model)) return "non-frontier";
  if (NEAR_FRONTIER_PATTERN.test(model)) return "near-frontier";
  return "frontier";
}

/** True when `model` is matched by an explicit rule rather than the conservative frontier default. */
export function isKnownModel(model: string | undefined): boolean {
  if (!model) return false;
  return model === "frontier" || NON_FRONTIER_PATTERN.test(model) || NEAR_FRONTIER_PATTERN.test(model) || /opus|gpt-5|gpt-4(?!o)|\bo[134]\b|fable/i.test(model);
}
