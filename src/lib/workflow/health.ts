import type { WorkflowTrace } from "./types";
import type { StepClassification } from "./classify";

export interface WorkflowHealthReport {
  traceId: string;
  /** Fraction of steps currently implemented as a model call, regardless of what they should be. */
  modelStepShare: number;
  /** Steps whose classification says they shouldn't be a model call at all. */
  downgradeableStepIds: string[];
  isDecompositionCandidate: boolean;
  reasons: string[];
}

/**
 * Phase 5.5 — flags workflows still being run "workflow-level" (most steps
 * routed through a model, regardless of whether each one needs it) as
 * decomposition candidates, i.e. exactly the failure mode the README's
 * source article describes: pointing a frontier agent at the whole thing
 * instead of breaking it into tasks first.
 */
export function assessWorkflowHealth(trace: WorkflowTrace, classifications: StepClassification[]): WorkflowHealthReport {
  const classificationById = new Map(classifications.map((c) => [c.stepId, c]));
  const modelSteps = trace.steps.filter((s) => s.implementation.kind === "model");
  const modelStepShare = trace.steps.length > 0 ? modelSteps.length / trace.steps.length : 0;

  const downgradeableStepIds = modelSteps
    .filter((step) => {
      const c = classificationById.get(step.id);
      return c?.classification === "deterministic" || c?.classification === "cacheable";
    })
    .map((step) => step.id);

  const reasons: string[] = [];
  if (modelStepShare > 0.5) {
    reasons.push(`${(modelStepShare * 100).toFixed(0)}% of steps are currently routed through a model call.`);
  }
  if (downgradeableStepIds.length > 0) {
    reasons.push(`${downgradeableStepIds.length} step(s) classified deterministic/cacheable are still implemented as model calls: ${downgradeableStepIds.join(", ")}.`);
  }

  return {
    traceId: trace.id,
    modelStepShare,
    downgradeableStepIds,
    isDecompositionCandidate: reasons.length > 0,
    reasons,
  };
}
