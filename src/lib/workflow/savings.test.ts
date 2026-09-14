import { describe, expect, it } from "vitest";
import { computeTraceSavings, DEFAULT_ASSUMPTIONS, formatSavingsReport } from "./savings";
import { classifyTrace } from "./classify";
import { apInvoiceProcessingTrace } from "./fixtures/ap-invoice-processing";

describe("computeTraceSavings on the AP fixture", () => {
  const classifications = classifyTrace(apInvoiceProcessingTrace);
  const report = computeTraceSavings(apInvoiceProcessingTrace, classifications);

  it("zeroes out cost for code and human steps", () => {
    const code = report.steps.find((s) => s.stepId === "receive_invoice")!;
    const human = report.steps.find((s) => s.stepId === "route_for_human_approval")!;
    expect(code.currentUsd).toBe(0);
    expect(code.recommendedUsd).toBe(0);
    expect(human.currentUsd).toBe(0);
    expect(human.recommendedUsd).toBe(0);
  });

  it("recommends zero cost for downgraded deterministic/cacheable steps", () => {
    const glCode = report.steps.find((s) => s.stepId === "gl_code_line_item")!;
    const approval = report.steps.find((s) => s.stepId === "check_approval_threshold")!;
    // gl_code_line_item is cacheable, not fully zero -- only deterministic is exactly zero.
    expect(approval.recommendedUsd).toBe(0);
    expect(glCode.recommendedUsd).toBeLessThan(glCode.currentUsd);
  });

  it("keeps flag_anomaly on frontier with no reduction", () => {
    const anomaly = report.steps.find((s) => s.stepId === "flag_anomaly")!;
    expect(anomaly.recommendedUsd).toBeCloseTo(anomaly.currentUsd, 5);
  });

  it("produces a positive overall savings percentage vs. naive frontier baseline", () => {
    expect(report.totals.savingsVsNaiveFrontierPct).toBeGreaterThan(0.4);
    expect(report.totals.savingsVsNaiveFrontierPct).toBeLessThan(0.65);
  });

  it("recommended spend never exceeds current spend for this fixture", () => {
    expect(report.totals.recommendedUsd).toBeLessThanOrEqual(report.totals.currentUsd);
  });

  it("uses DEFAULT_ASSUMPTIONS when none are passed", () => {
    expect(report.assumptions).toEqual(DEFAULT_ASSUMPTIONS);
  });
});

describe("formatSavingsReport", () => {
  it("renders every step id and the totals block", () => {
    const classifications = classifyTrace(apInvoiceProcessingTrace);
    const report = computeTraceSavings(apInvoiceProcessingTrace, classifications);
    const text = formatSavingsReport(report);
    for (const step of apInvoiceProcessingTrace.steps) {
      expect(text).toContain(step.id);
    }
    expect(text).toContain("Naive single-frontier-model baseline");
    expect(text).toContain("Savings vs. naive frontier baseline");
  });
});
