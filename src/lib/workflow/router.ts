import type { TaskClassification, WorkflowStep, WorkflowTrace } from "./types";
import type { StepClassification } from "./classify";
import type { ResourceTier } from "./pricing";

export type ResourceKind = "code" | "cache" | "model" | "human";

export interface Resource {
  kind: ResourceKind;
  /** Only set when kind === "model". */
  tier?: ResourceTier;
}

export interface RoutingPolicy {
  /** Below this confidence, don't trust the classification's default resource — escalate to a safety-net tier instead. */
  minConfidence: number;
  /** Model tier used as the safety net for low-confidence deterministic/cacheable steps. */
  fallbackTier: ResourceTier;
}

export const DEFAULT_ROUTING_POLICY: RoutingPolicy = {
  minConfidence: 0.6,
  fallbackTier: "non-frontier",
};

const MODEL_TIER_LADDER: ResourceTier[] = ["non-frontier", "near-frontier", "frontier"];

function escalateTier(tier: ResourceTier): ResourceTier {
  const idx = MODEL_TIER_LADDER.indexOf(tier);
  return MODEL_TIER_LADDER[Math.min(idx + 1, MODEL_TIER_LADDER.length - 1)];
}

export interface RoutingDecision {
  stepId: string;
  classification: TaskClassification;
  resource: Resource;
  /** True when the router overrode the classification's default resource due to low confidence. */
  escalated: boolean;
  rationale: string;
}

/**
 * Phase 2.2/2.3 — given a step's classification, picks the cheapest resource
 * with acceptable reliability, escalating past the classification's default
 * when confidence is too low to trust it. Escalation is the exception path:
 * a well-classified workflow should mostly hit the `escalated: false` branches.
 */
export function routeStep(
  step: WorkflowStep,
  classification: StepClassification,
  policy: RoutingPolicy = DEFAULT_ROUTING_POLICY,
): RoutingDecision {
  if (step.implementation.kind === "human") {
    return {
      stepId: step.id,
      classification: classification.classification,
      resource: { kind: "human" },
      escalated: false,
      rationale: "Human-in-the-loop step; router passes it through unchanged.",
    };
  }

  const lowConfidence = classification.confidence < policy.minConfidence;

  switch (classification.classification) {
    case "deterministic":
      if (lowConfidence) {
        return {
          stepId: step.id,
          classification: classification.classification,
          resource: { kind: "model", tier: policy.fallbackTier },
          escalated: true,
          rationale: `Confidence ${classification.confidence} < ${policy.minConfidence} — not confident enough to trust as pure code; fall back to a ${policy.fallbackTier} model rather than skip the model entirely.`,
        };
      }
      return {
        stepId: step.id,
        classification: classification.classification,
        resource: { kind: "code" },
        escalated: false,
        rationale: "High-confidence deterministic step — route to code.",
      };

    case "cacheable":
      if (lowConfidence) {
        return {
          stepId: step.id,
          classification: classification.classification,
          resource: { kind: "model", tier: policy.fallbackTier },
          escalated: true,
          rationale: `Confidence ${classification.confidence} < ${policy.minConfidence} — skip the cache attempt and call a ${policy.fallbackTier} model until the input->output mapping is validated.`,
        };
      }
      return {
        stepId: step.id,
        classification: classification.classification,
        resource: { kind: "cache" },
        escalated: false,
        rationale: "High-confidence cacheable step — check cache first; a cache miss falls back to a non-frontier model.",
      };

    case "simple-judgment": {
      const tier: ResourceTier = lowConfidence ? escalateTier("non-frontier") : "non-frontier";
      return {
        stepId: step.id,
        classification: classification.classification,
        resource: { kind: "model", tier },
        escalated: lowConfidence,
        rationale: lowConfidence
          ? `Confidence ${classification.confidence} < ${policy.minConfidence} — escalate one tier to ${tier}.`
          : "Route to a non-frontier model.",
      };
    }

    case "complex-judgment":
      return {
        stepId: step.id,
        classification: classification.classification,
        resource: { kind: "model", tier: "frontier" },
        escalated: false,
        rationale: "Already the top tier — route to a frontier model.",
      };
  }
}

export function routeTrace(
  trace: WorkflowTrace,
  classifications: StepClassification[],
  policy: RoutingPolicy = DEFAULT_ROUTING_POLICY,
): RoutingDecision[] {
  const byId = new Map(classifications.map((c) => [c.stepId, c]));
  return trace.steps.map((step) => {
    const classification = byId.get(step.id);
    if (!classification) throw new Error(`Missing classification for step "${step.id}"`);
    return routeStep(step, classification, policy);
  });
}

export interface RoutingDistribution {
  totalSteps: number;
  code: number;
  cache: number;
  human: number;
  model: Record<ResourceTier, number>;
  /** The "90/9/1" framing: each tier's share of calls that actually hit a model (excludes code/cache/human). */
  modelSharePct: Record<ResourceTier, number>;
  escalatedCount: number;
}

/** Phase 5.2 — tracks the 90/9/1 split in practice: what fraction of model calls land on each tier. */
export function summarizeRouting(decisions: RoutingDecision[]): RoutingDistribution {
  const model: Record<ResourceTier, number> = { "non-frontier": 0, "near-frontier": 0, frontier: 0 };
  let code = 0;
  let cache = 0;
  let human = 0;
  let escalatedCount = 0;

  for (const d of decisions) {
    if (d.escalated) escalatedCount++;
    if (d.resource.kind === "code") code++;
    else if (d.resource.kind === "cache") cache++;
    else if (d.resource.kind === "human") human++;
    else if (d.resource.kind === "model" && d.resource.tier) model[d.resource.tier]++;
  }

  const totalModelCalls = model["non-frontier"] + model["near-frontier"] + model.frontier;
  const modelSharePct: Record<ResourceTier, number> = {
    "non-frontier": totalModelCalls > 0 ? model["non-frontier"] / totalModelCalls : 0,
    "near-frontier": totalModelCalls > 0 ? model["near-frontier"] / totalModelCalls : 0,
    frontier: totalModelCalls > 0 ? model.frontier / totalModelCalls : 0,
  };

  return { totalSteps: decisions.length, code, cache, human, model, modelSharePct, escalatedCount };
}
