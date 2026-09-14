import { describe, expect, it } from "vitest";
import { assessWorkflowHealth } from "./health";
import { classifyTrace } from "./classify";
import { apInvoiceProcessingTrace } from "./fixtures/ap-invoice-processing";
import type { WorkflowTrace } from "./types";

describe("assessWorkflowHealth", () => {
  it("flags the AP fixture as a decomposition candidate", () => {
    const classifications = classifyTrace(apInvoiceProcessingTrace);
    const report = assessWorkflowHealth(apInvoiceProcessingTrace, classifications);
    expect(report.isDecompositionCandidate).toBe(true);
    expect(report.downgradeableStepIds.sort()).toEqual(["check_approval_threshold", "gl_code_line_item"]);
  });

  it("computes modelStepShare as the fraction of steps implemented as a model call", () => {
    const classifications = classifyTrace(apInvoiceProcessingTrace);
    const report = assessWorkflowHealth(apInvoiceProcessingTrace, classifications);
    const modelSteps = apInvoiceProcessingTrace.steps.filter((s) => s.implementation.kind === "model").length;
    expect(report.modelStepShare).toBeCloseTo(modelSteps / apInvoiceProcessingTrace.steps.length);
  });

  it("does not flag a fully-code, well-classified trace", () => {
    const trace: WorkflowTrace = {
      id: "t",
      name: "t",
      steps: [
        {
          id: "a",
          name: "a",
          description: "apply a fixed rule",
          implementation: { kind: "code", description: "x" },
          inputs: [],
          outputs: [],
          dependsOn: [],
        },
      ],
    };
    const classifications = classifyTrace(trace);
    const report = assessWorkflowHealth(trace, classifications);
    expect(report.isDecompositionCandidate).toBe(false);
    expect(report.downgradeableStepIds).toEqual([]);
  });
});
