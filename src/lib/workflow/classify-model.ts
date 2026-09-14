import type { WorkflowStep, WorkflowTrace } from "./types";
import { classifyStep, DEFAULT_RULES, type ClassificationRule, type StepClassification } from "./classify";

/**
 * Phase 1.3/"Next up" #3 — prompt-based classifier fallback. `classify.ts`'s
 * rules-based classifier is conservative by design: an unmatched step
 * defaults to `complex-judgment` rather than guessing a downgrade (see
 * `fallback:no-rule-matched` in classify.ts). That's the right default for a
 * step nobody has looked at, but it also means every step outside the rules'
 * keyword coverage — e.g. "assess sentiment" or "draft a reply", surfaced by
 * the support-ticket-triage fixture — silently stacks up on the frontier
 * tier even when a small model could classify it with real judgment.
 *
 * This module doesn't call any specific model provider. It takes a
 * `ModelClassifier` function as a dependency — the caller wires up whatever
 * client/API key they have — and only invokes it for steps the rules
 * couldn't confidently place, so the (metered, non-deterministic) model call
 * is the exception path, not the default one.
 */

export interface ModelClassifierInput {
  step: WorkflowStep;
  /** The rules-based result that triggered the fallback (always the "no rule matched" case, confidence 0.3). */
  ruleResult: StepClassification;
}

export interface ModelClassifierOutput {
  classification: StepClassification["classification"];
  /** 0-1. The model's own confidence in this classification — distinct from (and typically lower-trust than) a rule's confidence. */
  confidence: number;
  rationale: string;
}

/** A model call, injected by the caller. Kept provider-agnostic on purpose — see module docstring. */
export type ModelClassifier = (input: ModelClassifierInput) => Promise<ModelClassifierOutput>;

export interface ClassifyWithFallbackOptions {
  rules?: ClassificationRule[];
  /** Only fall back to the model when the rules-based confidence is at or below this (the "no rule matched" default is 0.3). */
  fallbackBelowConfidence?: number;
}

const DEFAULT_FALLBACK_BELOW_CONFIDENCE = 0.5;

/**
 * Classifies a single step: try the rules first, and only pay for a model
 * call when the rules didn't confidently match. On a model-classifier
 * failure (network error, bad output, etc.), falls back to the rules result
 * rather than throwing — a classification pipeline shouldn't go down because
 * one fallback call failed.
 */
export async function classifyStepWithFallback(
  step: WorkflowStep,
  modelClassifier: ModelClassifier,
  options: ClassifyWithFallbackOptions = {},
): Promise<StepClassification> {
  const rules = options.rules ?? DEFAULT_RULES;
  const fallbackBelowConfidence = options.fallbackBelowConfidence ?? DEFAULT_FALLBACK_BELOW_CONFIDENCE;

  const ruleResult = classifyStep(step, rules);
  if (ruleResult.confidence > fallbackBelowConfidence) {
    return ruleResult;
  }

  try {
    const modelResult = await modelClassifier({ step, ruleResult });
    return {
      stepId: step.id,
      classification: modelResult.classification,
      confidence: modelResult.confidence,
      rationale: modelResult.rationale,
      signals: [...ruleResult.signals, "fallback:model-classified"],
    };
  } catch (err) {
    return {
      ...ruleResult,
      rationale: `${ruleResult.rationale} (model fallback failed: ${err instanceof Error ? err.message : String(err)}; kept rules-based result.)`,
      signals: [...ruleResult.signals, "fallback:model-error"],
    };
  }
}

export async function classifyTraceWithFallback(
  trace: WorkflowTrace,
  modelClassifier: ModelClassifier,
  options: ClassifyWithFallbackOptions = {},
): Promise<StepClassification[]> {
  return Promise.all(trace.steps.map((step) => classifyStepWithFallback(step, modelClassifier, options)));
}
