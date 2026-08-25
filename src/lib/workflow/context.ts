import type { WorkflowStep, WorkflowTrace } from "./types";
import { estimateTokensFromValue } from "./tokens";

/**
 * Phase 4 — Context/harness minimization. A step's `inputs` (declared in
 * its WorkflowStep) already define the minimal schema it needs; this module
 * builds that scoped payload, contrasts it against the "dump full workflow
 * history into every call" default most agent harnesses fall into, and
 * measures the resulting bloat.
 */

export interface ScopedContext {
  stepId: string;
  fields: Record<string, unknown>;
  tokenEstimate: number;
}

/** Phase 4.1/4.2 — the minimal context for a step: only its declared inputs. */
export function buildScopedContext(step: WorkflowStep): ScopedContext {
  const fields: Record<string, unknown> = {};
  for (const input of step.inputs) fields[input.name] = input.value;
  return { stepId: step.id, fields, tokenEstimate: estimateTokensFromValue(fields) };
}

/** The naive default: every prior step's outputs, dumped into every call regardless of relevance. */
export function buildFullHistoryContext(trace: WorkflowTrace, uptoStepId: string): ScopedContext {
  const fields: Record<string, unknown> = {};
  for (const step of trace.steps) {
    for (const output of step.outputs) fields[`${step.id}.${output.name}`] = output.value;
    if (step.id === uptoStepId) break;
  }
  return { stepId: uptoStepId, fields, tokenEstimate: estimateTokensFromValue(fields) };
}

export interface ContextBloatReport {
  stepId: string;
  scopedTokens: number;
  fullHistoryTokens: number;
  /** fullHistory / scoped — 1 means no bloat, 5 means a naive harness would send 5x the tokens this step actually needs. */
  bloatRatio: number;
}

/** Phase 4.3 — how much context bloat a step would carry under the naive full-history default vs. its scoped inputs. */
export function measureContextBloat(trace: WorkflowTrace, step: WorkflowStep): ContextBloatReport {
  const scoped = buildScopedContext(step);
  const full = buildFullHistoryContext(trace, step.id);
  const bloatRatio = scoped.tokenEstimate > 0 ? full.tokenEstimate / scoped.tokenEstimate : full.tokenEstimate > 0 ? Infinity : 1;
  return { stepId: step.id, scopedTokens: scoped.tokenEstimate, fullHistoryTokens: full.tokenEstimate, bloatRatio };
}

export function measureTraceContextBloat(trace: WorkflowTrace): ContextBloatReport[] {
  return trace.steps.map((step) => measureContextBloat(trace, step));
}
