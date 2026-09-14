import { describe, expect, it } from "vitest";
import { classifyStep, classifyTrace, summarizeClassification } from "./classify";
import { apInvoiceProcessingTrace } from "./fixtures/ap-invoice-processing";
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

describe("classifyStep", () => {
  it("classifies an already-code step as deterministic with full confidence", () => {
    const result = classifyStep(step({ implementation: { kind: "code", description: "x" } }));
    expect(result).toMatchObject({ classification: "deterministic", confidence: 1 });
  });

  it("classifies an already-human step as complex-judgment", () => {
    const result = classifyStep(step({ implementation: { kind: "human", role: "manager" } }));
    expect(result.classification).toBe("complex-judgment");
  });

  it("flags high-stakes keywords as complex-judgment ahead of other rules", () => {
    const result = classifyStep(
      step({ name: "flag_anomaly", description: "Assess whether this invoice looks anomalous or fraudulent" }),
    );
    expect(result.classification).toBe("complex-judgment");
    expect(result.signals).toContain("keyword:high-stakes");
  });

  it("classifies a fixed threshold lookup with a small-enum output as deterministic", () => {
    const result = classifyStep(
      step({
        name: "check_approval_threshold",
        description: "Determine approval per a fixed dollar-threshold policy",
        outputs: [{ name: "approval.required", value: true }],
      }),
    );
    expect(result.classification).toBe("deterministic");
  });

  it("classifies categorization/mapping steps as cacheable", () => {
    const result = classifyStep(step({ name: "gl_code_line_item", description: "Assign a GL code to each line item" }));
    expect(result.classification).toBe("cacheable");
  });

  it("classifies unstructured extraction as simple-judgment", () => {
    const result = classifyStep(step({ name: "extract_line_items", description: "Read the invoice and extract line items" }));
    expect(result.classification).toBe("simple-judgment");
  });

  it("falls back to complex-judgment with low confidence when no rule matches", () => {
    const result = classifyStep(step({ name: "mystery_step", description: "do something inscrutable" }));
    expect(result.classification).toBe("complex-judgment");
    expect(result.confidence).toBeLessThan(0.5);
    expect(result.signals).toContain("fallback:no-rule-matched");
  });

  it("does not classify a judgment call as deterministic just because it mentions a threshold it explicitly can't rely on", () => {
    const result = classifyStep(
      step({
        name: "assess_borderline_context",
        description: "Weigh context (satire, cultural context) that a fixed score can't capture",
        outputs: [{ name: "context_assessment.override", value: false }],
      }),
    );
    expect(result.classification).toBe("complex-judgment");
    expect(result.signals).toContain("keyword:context-override");
  });

  it("classifies a bounded numeric rubric score as simple-judgment, not deterministic", () => {
    const result = classifyStep(
      step({
        name: "score_toxicity",
        description: "Score the post against a fixed policy threshold table (0-100 toxicity scale)",
        outputs: [{ name: "toxicity.score", value: 42 }],
      }),
    );
    expect(result.classification).toBe("simple-judgment");
    expect(result.signals).toContain("keyword:bounded-scoring-rubric");
  });

  it("does not treat an arbitrary number without rubric/scale language as a bounded score", () => {
    const result = classifyStep(
      step({ name: "count_items", description: "Count the number of line items on the invoice", outputs: [{ name: "count", value: 3 }] }),
    );
    expect(result.classification).not.toBe("simple-judgment");
  });

  it("classifies a fixed policy-table lookup with a small nested-object output as deterministic", () => {
    const result = classifyStep(
      step({
        name: "decide_action",
        description: "Apply the fixed policy decision table to decide the action and reason",
        outputs: [{ name: "moderation.decision", value: { action: "allow", reason: "below_threshold" } }],
      }),
    );
    expect(result.classification).toBe("deterministic");
    expect(result.signals).toEqual(expect.arrayContaining(["keyword:policy-or-threshold", "output:small-enum"]));
  });

  it("does not treat a large or deeply-valued object as a small-enum output", () => {
    const result = classifyStep(
      step({
        name: "apply_policy",
        description: "Apply the fixed policy threshold table",
        outputs: [{ name: "decision", value: { action: "allow", reason: "ok", note: "x", extra: "y", fifth: "z" } }],
      }),
    );
    expect(result.classification).not.toBe("deterministic");
  });
});

describe("classifyTrace / summarizeClassification against the AP fixture", () => {
  const classifications = classifyTrace(apInvoiceProcessingTrace);

  it("classifies exactly the two documented downgrade candidates", () => {
    const summary = summarizeClassification(apInvoiceProcessingTrace, classifications);
    const ids = summary.downgradeCandidates.map((c) => c.stepId).sort();
    expect(ids).toEqual(["check_approval_threshold", "gl_code_line_item"]);
  });

  it("keeps flag_anomaly and extract_line_items off the downgrade list", () => {
    const summary = summarizeClassification(apInvoiceProcessingTrace, classifications);
    const ids = summary.downgradeCandidates.map((c) => c.stepId);
    expect(ids).not.toContain("flag_anomaly");
    expect(ids).not.toContain("extract_line_items");
  });

  it("counts modelOrHumanSteps as every non-code step", () => {
    const summary = summarizeClassification(apInvoiceProcessingTrace, classifications);
    const nonCodeCount = apInvoiceProcessingTrace.steps.filter((s) => s.implementation.kind !== "code").length;
    expect(summary.modelOrHumanSteps).toBe(nonCodeCount);
  });
});
