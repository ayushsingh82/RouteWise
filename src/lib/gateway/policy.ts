import { DEFAULT_PRICING, type ResourceTier, type TierPricing } from "../workflow/pricing";
import { DEFAULT_ROUTING_POLICY, type RoutingPolicy } from "../workflow/router";
import type { Provider } from "./types";

export interface GatewayPolicy {
  routing: RoutingPolicy;
  pricing: Record<ResourceTier, TierPricing>;
  /** Concrete model to call for each (provider, tier) when downgrading. Override to match what your account can use. */
  tierModels: Record<Exclude<Provider, "other">, Record<ResourceTier, string>>;
  /** Only cache requests at or below this temperature (unset temperature counts as 1, the providers' default). Default 0.2. */
  cacheTemperatureMax: number;
  /** Allow downgrading requests that define tools / structured output. Default false: pass through. */
  allowDowngradeWithTools: boolean;
  /** Don't act on a task until this many calls have been observed (cold-start guard). Default 8. */
  minObservations: number;
  cacheMaxEntries: number;
  cacheTtlMs: number;
}

export const DEFAULT_GATEWAY_POLICY: GatewayPolicy = {
  routing: DEFAULT_ROUTING_POLICY,
  pricing: DEFAULT_PRICING,
  tierModels: {
    anthropic: { frontier: "claude-opus-5-5", "near-frontier": "claude-sonnet-5-5", "non-frontier": "claude-haiku-5-5" },
    openai: { frontier: "gpt-5", "near-frontier": "gpt-4.1", "non-frontier": "gpt-4o-mini" },
  },
  cacheTemperatureMax: 0.2,
  allowDowngradeWithTools: false,
  minObservations: 8,
  cacheMaxEntries: 5000,
  cacheTtlMs: 24 * 60 * 60 * 1000,
};
