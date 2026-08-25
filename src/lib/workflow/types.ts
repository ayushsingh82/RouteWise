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
}

export interface WorkflowTrace {
  id: string;
  name: string;
  description?: string;
  steps: WorkflowStep[];
}
