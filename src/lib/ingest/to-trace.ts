import type { WorkflowTrace } from "../workflow/types";
import { DEFAULT_PRICING, type ResourceTier, type TierPricing } from "../workflow/pricing";
import type { CallRecord } from "./types";
import { hashString } from "./util";
import { TaskAggregator } from "./aggregate";
import { taskKey, taskLabel } from "./to-trace-shared";

export { CACHED_INPUT_DISCOUNT, callCostUsd, callCostAtTierUsd, normalizeInput, taskKey, taskLabel } from "./to-trace-shared";

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48) || "task";
}

export interface TraceBuildOptions {
  id?: string;
  name?: string;
  description?: string;
  pricing?: Record<ResourceTier, TierPricing>;
}

export interface TaskGroup {
  key: string;
  stepId: string;
  calls: CallRecord[];
}

/** Groups calls into tasks (first-appearance order) with unique, stable step ids. */
export function groupCallsByTask(calls: CallRecord[]): TaskGroup[] {
  const groups = new Map<string, TaskGroup>();
  const usedIds = new Set<string>();
  for (const call of calls) {
    const key = taskKey(call);
    let g = groups.get(key);
    if (!g) {
      const base = slug(taskLabel(call));
      let stepId = base;
      for (let n = 2; usedIds.has(stepId); n++) stepId = `${base}_${n}`;
      usedIds.add(stepId);
      g = { key, stepId, calls: [] };
      groups.set(key, g);
    }
    g.calls.push(call);
  }
  return [...groups.values()];
}

/**
 * Aggregates recorded calls into a WorkflowTrace with one step per distinct
 * task, so the existing classify -> route -> savings pipeline (src/lib/workflow)
 * runs unchanged over real traffic. Token and dollar totals are summed across
 * every call of the task (the pipeline's math is linear in tokens), and
 * `observedStats` carries the repeat-input / output-consistency signals the
 * classifier uses to spot cacheable and bounded tasks.
 */
/**
 * Aggregates recorded calls into a WorkflowTrace with one step per distinct
 * task, so the existing classify -> route -> savings pipeline (src/lib/workflow)
 * runs unchanged over real traffic. Token and dollar totals are summed across
 * every call of the task (the pipeline's math is linear in tokens), and
 * `observedStats` carries the repeat-input / output-consistency signals the
 * classifier uses to spot cacheable and bounded tasks.
 */
export function callsToWorkflowTrace(calls: CallRecord[], opts: TraceBuildOptions = {}): WorkflowTrace {
  const pricing = opts.pricing ?? DEFAULT_PRICING;
  const steps = groupCallsByTask(calls).map(({ stepId, calls: group }) => {
    const agg = new TaskAggregator(pricing);
    for (const c of group) agg.add(c);
    return agg.toStep(stepId);
  });

  const sources = [...new Set(calls.map((c) => c.source))];
  return {
    id: opts.id ?? `ingested-${hashString(calls.map((c) => c.id).join("|")).slice(0, 8)}`,
    name: opts.name ?? `Ingested ${sources.join("+")} trace`,
    description: opts.description ?? `${calls.length} recorded calls across ${steps.length} distinct task(s), from ${sources.join(", ")}.`,
    steps,
  };
}
