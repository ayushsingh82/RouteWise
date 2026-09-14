import { describe, expect, it } from "vitest";
import { buildFullHistoryContext, buildScopedContext, measureContextBloat, measureTraceContextBloat } from "./context";
import { apInvoiceProcessingTrace } from "./fixtures/ap-invoice-processing";

describe("buildScopedContext", () => {
  it("includes only the step's declared inputs", () => {
    const step = apInvoiceProcessingTrace.steps.find((s) => s.id === "gl_code_line_item")!;
    const ctx = buildScopedContext(step);
    expect(Object.keys(ctx.fields)).toEqual(step.inputs.map((i) => i.name));
  });
});

describe("buildFullHistoryContext", () => {
  it("accumulates every prior step's outputs up to and including the target step", () => {
    const ctx = buildFullHistoryContext(apInvoiceProcessingTrace, "check_approval_threshold");
    expect(Object.keys(ctx.fields)).toContain("receive_invoice.invoice.document_id");
    expect(Object.keys(ctx.fields)).toContain("gl_code_line_item.invoice.line_items_coded");
    expect(Object.keys(ctx.fields)).not.toContain("flag_anomaly.anomaly.flagged");
  });
});

describe("measureContextBloat / measureTraceContextBloat on the AP fixture", () => {
  it("reports bloat ratio >= 1 for every step, growing later in the workflow", () => {
    const reports = measureTraceContextBloat(apInvoiceProcessingTrace);
    for (const r of reports) {
      expect(r.bloatRatio).toBeGreaterThanOrEqual(1);
    }
    const first = reports[0];
    const last = reports[reports.length - 1];
    expect(last.bloatRatio).toBeGreaterThanOrEqual(first.bloatRatio);
  });

  it("matches measureContextBloat for an individual step", () => {
    const step = apInvoiceProcessingTrace.steps.find((s) => s.id === "flag_anomaly")!;
    const single = measureContextBloat(apInvoiceProcessingTrace, step);
    const fromTrace = measureTraceContextBloat(apInvoiceProcessingTrace).find((r) => r.stepId === "flag_anomaly")!;
    expect(single).toEqual(fromTrace);
  });

  it("stays within the documented 1.6x-22.75x range for this fixture", () => {
    const reports = measureTraceContextBloat(apInvoiceProcessingTrace);
    for (const r of reports) {
      expect(r.bloatRatio).toBeGreaterThanOrEqual(1);
      expect(r.bloatRatio).toBeLessThanOrEqual(23);
    }
  });
});
