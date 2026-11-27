import type { WorkflowStep } from "../workflow/types";
import { DEFAULT_PRICING, type ResourceTier, type TierPricing } from "../workflow/pricing";
import type { CallRecord } from "./types";
import { callCostUsd, normalizeInput, taskLabel } from "./to-trace-shared";

const MAX_TRACKED_INPUTS = 20_000;
const MAX_TRACKED_OUTPUTS = 2_000;

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function tryParseJson(s: string): unknown {
  const t = s.trim();
  if (!/^[{[]/.test(t) && !/^(true|false)$/i.test(t)) return s;
  try {
    return JSON.parse(t);
  } catch {
    return s;
  }
}

/**
 * Incrementally accumulates everything the classifier needs to know about one
 * task from its calls, in bounded memory. The same class backs offline trace
 * building (`callsToWorkflowTrace`) and the live gateway's online learner, so
 * a task is classified identically whether it's seen in a file or on the wire.
 */
export class TaskAggregator {
  private first: CallRecord | null = null;
  private seenInputs = new Map<string, string>();
  private outputCounts = new Map<string, number>();
  private outputOverflow = 0;
  private modelCounts = new Map<string, number>();
  private repeats = 0;
  private consistentRepeats = 0;
  calls = 0;
  inputTokens = 0;
  outputTokens = 0;
  usd = 0;

  constructor(private pricing: Record<ResourceTier, TierPricing> = DEFAULT_PRICING) {}

  add(c: CallRecord): void {
    this.first ??= c;
    this.calls++;
    const key = normalizeInput(c.input);
    const out = normalizeInput(c.output);
    const prior = this.seenInputs.get(key);
    if (prior !== undefined) {
      this.repeats++;
      if (prior === out) this.consistentRepeats++;
    } else if (this.seenInputs.size < MAX_TRACKED_INPUTS) {
      this.seenInputs.set(key, out);
    }
    if (this.outputCounts.has(out) || this.outputCounts.size < MAX_TRACKED_OUTPUTS) this.outputCounts.set(out, (this.outputCounts.get(out) ?? 0) + 1);
    else this.outputOverflow++;
    this.modelCounts.set(c.model, (this.modelCounts.get(c.model) ?? 0) + 1);
    this.inputTokens += c.inputTokens;
    this.outputTokens += c.outputTokens;
    this.usd += callCostUsd(c, this.pricing);
  }

  toStep(stepId: string): WorkflowStep {
    const first = this.first;
    if (!first) throw new Error("TaskAggregator has no calls");
    const modalOutput = [...this.outputCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const dominantModel = [...this.modelCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const sysText = (first.system ?? "").replace(/\s+/g, " ").trim();
    const description = truncate(`${first.task ?? ""}${first.task && sysText ? ": " : ""}${sysText}`.trim() || `Calls to ${dominantModel}`, 600);
    return {
      id: stepId,
      name: taskLabel(first),
      description,
      implementation: { kind: "model", model: dominantModel, promptSummary: truncate(sysText, 160) || undefined },
      inputs: [{ name: "input", value: truncate(first.input, 500) }],
      outputs: [{ name: "output", value: tryParseJson(truncate(modalOutput, 500)) }],
      dependsOn: [],
      observedCost: { model: dominantModel, inputTokens: this.inputTokens, outputTokens: this.outputTokens, usdCost: this.usd },
      observedStats: {
        callCount: this.calls,
        repeatInputRate: this.repeats / this.calls,
        repeatOutputConsistency: this.repeats > 0 ? this.consistentRepeats / this.repeats : 1,
        uniqueOutputCount: this.outputCounts.size + this.outputOverflow,
        meanOutputTokens: this.outputTokens / this.calls,
      },
    };
  }
}
