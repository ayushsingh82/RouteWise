import { DEFAULT_PRICING, priceTokens, resolveTier, type ResourceTier, type TierPricing } from "../workflow/pricing";
import type { CallRecord } from "./types";
import { hashString } from "./util";

/** Prompt-cache reads are billed at roughly a tenth of the normal input price. Surfaced as an assumption in reports. */
export const CACHED_INPUT_DISCOUNT = 0.1;

/** USD cost of one call: the source-reported cost if it has one, otherwise priced from the tier table (cache reads discounted). */
export function callCostUsd(call: CallRecord, pricing: Record<ResourceTier, TierPricing> = DEFAULT_PRICING): number {
  if (call.costUsd !== undefined) return call.costUsd;
  const tier = resolveTier(call.model);
  const cached = Math.min(call.cachedInputTokens ?? 0, call.inputTokens);
  const fresh = call.inputTokens - cached;
  return priceTokens(tier, fresh, call.outputTokens, pricing) + priceTokens(tier, cached, 0, pricing) * CACHED_INPUT_DISCOUNT;
}

/** Same call, same tokens, priced as if it had run on `tier` instead (cache-read discount kept). */
export function callCostAtTierUsd(call: CallRecord, tier: ResourceTier, pricing: Record<ResourceTier, TierPricing> = DEFAULT_PRICING): number {
  const cached = Math.min(call.cachedInputTokens ?? 0, call.inputTokens);
  return priceTokens(tier, call.inputTokens - cached, call.outputTokens, pricing) + priceTokens(tier, cached, 0, pricing) * CACHED_INPUT_DISCOUNT;
}

/** The key two calls must share to be "the same input" for caching purposes: whitespace/case-normalized, nothing fuzzier. */
export function normalizeInput(input: string): string {
  return input.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Identity of a task across calls. The system prompt *is* the task when there is one — so a recorded run named
 * "kb_answer" and the same prompt arriving live with no name resolve to the same task, and the same name over two
 * different prompts stays two tasks. Without a system prompt, the span/run name is all there is.
 */
export function taskKey(call: Pick<CallRecord, "task" | "system">): string {
  if (call.system) return `sys:${hashString(call.system.replace(/\s+/g, " ").slice(0, 400))}`;
  return `task:${call.task ?? ""}`;
}

/** Human-readable task name: the span/run name if there is one, else the first sentence of the system prompt, else the key. */
export function taskLabel(call: Pick<CallRecord, "task" | "system" | "model">): string {
  if (call.task) return call.task;
  const first = (call.system ?? "").replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s/)[0];
  if (first) return first.length > 56 ? `${first.slice(0, 55)}…` : first;
  return `${call.model} calls`;
}
