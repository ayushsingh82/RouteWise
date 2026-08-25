import type { TaskClassification, WorkflowStep, WorkflowTrace } from "./types";
import type { StepClassification } from "./classify";
import { DEFAULT_PRICING, priceTokens, resolveTier, type ResourceTier, type TierPricing } from "./pricing";
import { resolveStepTokens } from "./tokens";

export interface SavingsAssumptions {
  pricing: Record<ResourceTier, TierPricing>;
  /** Fraction of `cacheable` calls expected to hit cache once warm (0-1). Misses still cost one non-frontier call. */
  cacheHitRate: number;
  /** Which tier `simple-judgment` steps get routed to. */
  simpleJudgmentTier: ResourceTier;
}

export const DEFAULT_ASSUMPTIONS: SavingsAssumptions = {
  pricing: DEFAULT_PRICING,
  cacheHitRate: 0.85,
  simpleJudgmentTier: "non-frontier",
};

export interface StepSavingsEstimate {
  stepId: string;
  classification: TaskClassification;
  tokenSource: "observed" | "estimated";
  inputTokens: number;
  outputTokens: number;
  /** What this step would cost if a single frontier model reasoned through the whole workflow (Figure 1/2's naive baseline), regardless of how it's implemented today. */
  naiveFrontierUsd: number;
  /** What this step actually costs today, given its current implementation. */
  currentUsd: number;
  /** What this step would cost if routed per its classification. */
  recommendedUsd: number;
  recommendedBasis: string;
}

export interface TraceSavingsTotals {
  naiveFrontierUsd: number;
  currentUsd: number;
  recommendedUsd: number;
  /** The ">90% reduction" headline: recommended vs. a naive single-frontier-model workflow. */
  savingsVsNaiveFrontierUsd: number;
  savingsVsNaiveFrontierPct: number;
  /** Savings vs. whatever the trace is actually spending today (0 if nothing here currently calls a model). */
  savingsVsCurrentUsd: number;
  savingsVsCurrentPct: number;
}

export interface TraceSavingsReport {
  traceId: string;
  traceName: string;
  assumptions: SavingsAssumptions;
  steps: StepSavingsEstimate[];
  totals: TraceSavingsTotals;
}

function estimateStep(
  step: WorkflowStep,
  classification: StepClassification,
  assumptions: SavingsAssumptions,
): StepSavingsEstimate {
  const { inputTokens, outputTokens, source } = resolveStepTokens(step);
  const naiveFrontierUsd = priceTokens("frontier", inputTokens, outputTokens, assumptions.pricing);

  if (step.implementation.kind === "code") {
    return {
      stepId: step.id,
      classification: classification.classification,
      tokenSource: source,
      inputTokens,
      outputTokens,
      naiveFrontierUsd,
      currentUsd: 0,
      recommendedUsd: 0,
      recommendedBasis: "Already plain code — no model call, nothing to save.",
    };
  }

  if (step.implementation.kind === "human") {
    return {
      stepId: step.id,
      classification: classification.classification,
      tokenSource: source,
      inputTokens,
      outputTokens,
      naiveFrontierUsd,
      currentUsd: 0,
      recommendedUsd: 0,
      recommendedBasis: "Human-in-the-loop step — outside token-spend scope.",
    };
  }

  // implementation.kind === "model"
  const currentUsd =
    step.observedCost?.usdCost ?? priceTokens(resolveTier(step.observedCost?.model), inputTokens, outputTokens, assumptions.pricing);

  let recommendedUsd: number;
  let recommendedBasis: string;

  switch (classification.classification) {
    case "deterministic":
      recommendedUsd = 0;
      recommendedBasis = "Classified deterministic — replace the model call with plain code.";
      break;
    case "cacheable": {
      const missRate = 1 - assumptions.cacheHitRate;
      recommendedUsd = missRate * priceTokens("non-frontier", inputTokens, outputTokens, assumptions.pricing);
      recommendedBasis = `Classified cacheable — cache input->output; assumes ${(assumptions.cacheHitRate * 100).toFixed(0)}% cache-hit rate once warm, misses handled by a non-frontier model.`;
      break;
    }
    case "simple-judgment":
      recommendedUsd = priceTokens(assumptions.simpleJudgmentTier, inputTokens, outputTokens, assumptions.pricing);
      recommendedBasis = `Classified simple-judgment — route to ${assumptions.simpleJudgmentTier} instead of frontier.`;
      break;
    case "complex-judgment":
      recommendedUsd = priceTokens("frontier", inputTokens, outputTokens, assumptions.pricing);
      recommendedBasis = "Classified complex-judgment — correctly stays on a frontier model; no downgrade recommended.";
      break;
  }

  return {
    stepId: step.id,
    classification: classification.classification,
    tokenSource: source,
    inputTokens,
    outputTokens,
    naiveFrontierUsd,
    currentUsd,
    recommendedUsd,
    recommendedBasis,
  };
}

function pct(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

/**
 * Phase 5.3 — computes the savings-estimate report: recommended routing
 * cost vs. (a) what a naive single-frontier-model workflow would cost for
 * every step, and (b) what the trace actually spends today.
 */
export function computeTraceSavings(
  trace: WorkflowTrace,
  classifications: StepClassification[],
  assumptions: SavingsAssumptions = DEFAULT_ASSUMPTIONS,
): TraceSavingsReport {
  const classificationById = new Map(classifications.map((c) => [c.stepId, c]));
  const steps = trace.steps.map((step) => {
    const classification = classificationById.get(step.id);
    if (!classification) throw new Error(`Missing classification for step "${step.id}"`);
    return estimateStep(step, classification, assumptions);
  });

  const totals = steps.reduce(
    (acc, s) => {
      acc.naiveFrontierUsd += s.naiveFrontierUsd;
      acc.currentUsd += s.currentUsd;
      acc.recommendedUsd += s.recommendedUsd;
      return acc;
    },
    { naiveFrontierUsd: 0, currentUsd: 0, recommendedUsd: 0 },
  );

  const savingsVsNaiveFrontierUsd = totals.naiveFrontierUsd - totals.recommendedUsd;
  const savingsVsCurrentUsd = totals.currentUsd - totals.recommendedUsd;

  return {
    traceId: trace.id,
    traceName: trace.name,
    assumptions,
    steps,
    totals: {
      ...totals,
      savingsVsNaiveFrontierUsd,
      savingsVsNaiveFrontierPct: pct(savingsVsNaiveFrontierUsd, totals.naiveFrontierUsd),
      savingsVsCurrentUsd,
      savingsVsCurrentPct: pct(savingsVsCurrentUsd, totals.currentUsd),
    },
  };
}

function usd(n: number): string {
  return `$${n.toFixed(4)}`;
}

/** Renders a shareable plain-text report — the artifact Product Wedge A (the analyzer/audit tool) sells. */
export function formatSavingsReport(report: TraceSavingsReport): string {
  const lines: string[] = [];
  lines.push(`Savings report — ${report.traceName} (${report.traceId})`);
  lines.push("");
  for (const s of report.steps) {
    lines.push(
      `  ${s.stepId.padEnd(24)} ${s.classification.padEnd(18)} naive=${usd(s.naiveFrontierUsd)} current=${usd(s.currentUsd)} recommended=${usd(s.recommendedUsd)}`,
    );
    lines.push(`    ${s.recommendedBasis}`);
  }
  lines.push("");
  lines.push(`Naive single-frontier-model baseline: ${usd(report.totals.naiveFrontierUsd)}`);
  lines.push(`Current spend:                        ${usd(report.totals.currentUsd)}`);
  lines.push(`Recommended spend:                    ${usd(report.totals.recommendedUsd)}`);
  lines.push(
    `Savings vs. naive frontier baseline:  ${usd(report.totals.savingsVsNaiveFrontierUsd)} (${(report.totals.savingsVsNaiveFrontierPct * 100).toFixed(1)}%)`,
  );
  lines.push(
    `Savings vs. current spend:            ${usd(report.totals.savingsVsCurrentUsd)} (${(report.totals.savingsVsCurrentPct * 100).toFixed(1)}%)`,
  );
  return lines.join("\n");
}
