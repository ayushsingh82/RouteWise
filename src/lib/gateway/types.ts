import type { TaskClassification } from "../workflow/types";
import type { ResourceTier } from "../workflow/pricing";

export type Provider = "openai" | "anthropic" | "other";

/** What the gateway sees of one inbound LLM request, normalized across providers. */
export interface GatewayRequest {
  provider: Provider;
  model: string;
  /** Explicit task label (header / metadata) if the caller supplied one; otherwise the engine derives identity from the system prompt. */
  task?: string;
  system?: string;
  input: string;
  temperature?: number;
  /** Request carries tool/function definitions or forces structured output — downgrading or caching may change behavior. */
  usesTools?: boolean;
  stream?: boolean;
}

export type GatewayAction = "passthrough" | "cache-hit" | "downgrade" | "code";

export interface GatewayDecision {
  action: GatewayAction;
  taskKey: string;
  classification: TaskClassification;
  confidence: number;
  requestedModel: string;
  requestedTier: ResourceTier;
  /** Model to actually call (== requestedModel unless downgraded). */
  targetModel: string;
  targetTier: ResourceTier;
  reason: string;
  /** Present for cache-hit. */
  cached?: CachedResponse;
}

export interface CachedResponse {
  output: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
}

/** What actually came back (or was recorded) for a request — fed to the engine so it can learn and warm its cache. */
export interface CallOutcome {
  output: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
  /** The response is safe to replay for an identical future request (completed normally, no tool calls). */
  cacheable: boolean;
}

export type Verification = "verified-equal" | "diverged" | "unverified" | "n/a";

/**
 * One routed call's accounting, identical whether it came from offline replay
 * (shadow mode) or the live proxy's ledger. baselineUsd is what the call cost
 * (or would have) on the model the caller asked for; policyUsd is what the
 * policy's choice costs.
 */
export interface DecisionRecord {
  id: string;
  ts: number | null;
  task: string;
  taskKey: string;
  action: GatewayAction;
  classification: TaskClassification;
  confidence: number;
  requestedModel: string;
  usedModel: string;
  baselineUsd: number;
  policyUsd: number;
  inputTokens: number;
  outputTokens: number;
  verification: Verification;
  /** True if the policy actually acted (enforce mode / live) rather than only simulating. */
  enforced: boolean;
}
