import type { WorkflowStep } from "./types";

/**
 * Rough tokens-from-characters estimator (~4 chars/token). This is the same
 * coarse approximation documented in research/mentlio/savings-methodology.md
 * ("the same chars-per-token model the daemon telemetry has always used") —
 * used here only as a fallback when a step has no observed token counts, and
 * should be labeled as estimated (not billed) wherever it surfaces.
 */
export function estimateTokensFromValue(value: unknown): number {
  const json = JSON.stringify(value ?? "");
  return Math.ceil(json.length / 4);
}

export interface StepTokenEstimate {
  inputTokens: number;
  outputTokens: number;
  source: "observed" | "estimated";
}

/** Uses the step's observedCost token counts if present; otherwise estimates from its input/output payload sizes. */
export function resolveStepTokens(step: WorkflowStep): StepTokenEstimate {
  const observed = step.observedCost;
  if (observed?.inputTokens !== undefined && observed?.outputTokens !== undefined) {
    return { inputTokens: observed.inputTokens, outputTokens: observed.outputTokens, source: "observed" };
  }
  const inputTokens = step.inputs.reduce((sum, f) => sum + estimateTokensFromValue(f.value), 0);
  const outputTokens = step.outputs.reduce((sum, f) => sum + estimateTokensFromValue(f.value), 0);
  return { inputTokens, outputTokens, source: "estimated" };
}
