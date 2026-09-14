import { describe, expect, it } from "vitest";
import { DEFAULT_ROUTING_POLICY, routeStep, routeTrace, summarizeRouting } from "./router";
import { classifyTrace } from "./classify";
import { apInvoiceProcessingTrace } from "./fixtures/ap-invoice-processing";
import type { StepClassification } from "./classify";
import type { WorkflowStep } from "./types";

function step(overrides: Partial<WorkflowStep>): WorkflowStep {
  return {
    id: "s",
    name: "s",
    description: "",
    implementation: { kind: "model", model: "frontier" },
    inputs: [],
    outputs: [],
    dependsOn: [],
    ...overrides,
  };
}

function classification(overrides: Partial<StepClassification>): StepClassification {
  return { stepId: "s", classification: "complex-judgment", confidence: 0.9, rationale: "", signals: [], ...overrides };
}

describe("routeStep", () => {
  it("passes a human step through unchanged", () => {
    const decision = routeStep(step({ implementation: { kind: "human", role: "manager" } }), classification({ classification: "complex-judgment" }));
    expect(decision.resource).toEqual({ kind: "human" });
    expect(decision.escalated).toBe(false);
  });

  it("routes a high-confidence deterministic step to code", () => {
    const decision = routeStep(step({}), classification({ classification: "deterministic", confidence: 0.9 }));
    expect(decision.resource).toEqual({ kind: "code" });
    expect(decision.escalated).toBe(false);
  });

  it("escalates a low-confidence deterministic step to the fallback tier instead of code", () => {
    const decision = routeStep(step({}), classification({ classification: "deterministic", confidence: 0.3 }));
    expect(decision.resource).toEqual({ kind: "model", tier: DEFAULT_ROUTING_POLICY.fallbackTier });
    expect(decision.escalated).toBe(true);
  });

  it("routes a high-confidence cacheable step to cache", () => {
    const decision = routeStep(step({}), classification({ classification: "cacheable", confidence: 0.9 }));
    expect(decision.resource).toEqual({ kind: "cache" });
  });

  it("escalates a low-confidence cacheable step to a model instead of cache", () => {
    const decision = routeStep(step({}), classification({ classification: "cacheable", confidence: 0.3 }));
    expect(decision.resource).toEqual({ kind: "model", tier: DEFAULT_ROUTING_POLICY.fallbackTier });
    expect(decision.escalated).toBe(true);
  });

  it("routes high-confidence simple-judgment to non-frontier", () => {
    const decision = routeStep(step({}), classification({ classification: "simple-judgment", confidence: 0.9 }));
    expect(decision.resource).toEqual({ kind: "model", tier: "non-frontier" });
    expect(decision.escalated).toBe(false);
  });

  it("escalates low-confidence simple-judgment one tier up", () => {
    const decision = routeStep(step({}), classification({ classification: "simple-judgment", confidence: 0.3 }));
    expect(decision.resource).toEqual({ kind: "model", tier: "near-frontier" });
    expect(decision.escalated).toBe(true);
  });

  it("always routes complex-judgment to frontier regardless of confidence", () => {
    const decision = routeStep(step({}), classification({ classification: "complex-judgment", confidence: 0.1 }));
    expect(decision.resource).toEqual({ kind: "model", tier: "frontier" });
    expect(decision.escalated).toBe(false);
  });
});

describe("routing the AP fixture", () => {
  const classifications = classifyTrace(apInvoiceProcessingTrace);
  const decisions = routeTrace(apInvoiceProcessingTrace, classifications);

  it("tightening minConfidence to 0.8 escalates extract_line_items and gl_code_line_item", () => {
    const strict = routeTrace(apInvoiceProcessingTrace, classifications, { minConfidence: 0.8, fallbackTier: "non-frontier" });
    const escalated = strict.filter((d) => d.escalated).map((d) => d.stepId);
    expect(escalated).toEqual(expect.arrayContaining(["extract_line_items", "gl_code_line_item"]));
  });

  it("does not escalate anything under the default policy", () => {
    expect(decisions.some((d) => d.escalated)).toBe(false);
  });

  it("summarizeRouting reports totals consistent with decisions", () => {
    const summary = summarizeRouting(decisions);
    expect(summary.totalSteps).toBe(decisions.length);
    const totalModel = summary.model["non-frontier"] + summary.model["near-frontier"] + summary.model.frontier;
    expect(summary.code + summary.cache + summary.human + totalModel).toBe(decisions.length);
  });
});
