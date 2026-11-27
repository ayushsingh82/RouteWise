/**
 * Core types for Phase 1 (Task decomposition engine) — see PLAN.md.
 *
 * A WorkflowTrace is how an existing agent run (or a hand-authored workflow
 * definition) gets ingested: a sequence of WorkflowSteps, each carrying what
 * it currently costs and how it's currently implemented, before
 * classification decides what it *should* be.
 */

export type TaskClassification =
  | "deterministic"
  | "cacheable"
  | "simple-judgment"
  | "complex-judgment";

export type StepImplementation =
  | { kind: "model"; model: string; promptSummary?: string }
  | { kind: "code"; description: string }
  | { kind: "human"; role: string };

export interface WorkflowStepField {
  name: string;
  value: unknown;
}

export interface StepObservedCost {
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  usdCost?: number;
}

/**
 * Statistics observed across many real calls of one task. Only present when
 * a trace was built from recorded production traffic (see src/lib/ingest);
 * hand-authored fixtures leave it undefined. This is the "historical output
 * variance" signal PLAN.md Phase 1.4 listed as an open item.
 */
export interface StepObservedStats {
  callCount: number;
  /** Fraction of calls whose (normalized) input had already appeared earlier in the trace. 0-1. */
  repeatInputRate: number;
  /** Of the calls with a repeated input, the fraction that produced the same output as the first time. 0-1 (1 when there were no repeats to compare). */
  repeatOutputConsistency: number;
  uniqueOutputCount: number;
  meanOutputTokens: number;
}

export interface WorkflowStep {
  /** Stable id within the trace; referenced by other steps' dependsOn. */
  id: string;
  /** Short machine name, e.g. "gl_code_line_item". */
  name: string;
  /** Human-readable description of what the step does. */
  description: string;
  /** How the step is implemented today, before any reclassification. */
  implementation: StepImplementation;
  inputs: WorkflowStepField[];
  outputs: WorkflowStepField[];
  /** ids of steps that must run before this one. */
  dependsOn: string[];
  /** Observed token/cost footprint of this step as currently implemented, if known. */
  observedCost?: StepObservedCost;
  /** Aggregate statistics over the recorded calls this step represents, if built from real traffic. */
  observedStats?: StepObservedStats;
}

export interface WorkflowTrace {
  id: string;
  name: string;
  description?: string;
  steps: WorkflowStep[];
}
