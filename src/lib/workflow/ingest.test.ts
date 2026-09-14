import { describe, expect, it } from "vitest";
import { extractStepsInOrder, ingestWorkflowTrace, WorkflowIngestError } from "./ingest";
import { apInvoiceProcessingTrace } from "./fixtures/ap-invoice-processing";

describe("ingestWorkflowTrace", () => {
  it("normalizes a well-formed raw trace", () => {
    const raw = {
      id: "t1",
      name: "Trace 1",
      steps: [
        {
          id: "a",
          name: "a",
          description: "step a",
          implementation: { kind: "code", description: "does a thing" },
          inputs: [{ name: "x", value: 1 }],
          outputs: [{ name: "y", value: 2 }],
        },
      ],
    };
    const trace = ingestWorkflowTrace(raw);
    expect(trace.id).toBe("t1");
    expect(trace.steps).toHaveLength(1);
    expect(trace.steps[0].dependsOn).toEqual([]);
  });

  it("defaults missing id/inputs/outputs/dependsOn", () => {
    const trace = ingestWorkflowTrace({
      id: "t1",
      name: "Trace 1",
      steps: [{ name: "a", description: "step a", implementation: { kind: "code", description: "x" } }],
    });
    expect(trace.steps[0].id).toBe("step-0");
    expect(trace.steps[0].inputs).toEqual([]);
    expect(trace.steps[0].outputs).toEqual([]);
  });

  it("rejects a non-object trace", () => {
    expect(() => ingestWorkflowTrace(null)).toThrow(WorkflowIngestError);
    expect(() => ingestWorkflowTrace("nope")).toThrow(WorkflowIngestError);
  });

  it("rejects a trace missing id/name", () => {
    expect(() => ingestWorkflowTrace({ name: "x", steps: [] })).toThrow(WorkflowIngestError);
    expect(() => ingestWorkflowTrace({ id: "x", steps: [] })).toThrow(WorkflowIngestError);
  });

  it("rejects an empty steps array", () => {
    expect(() => ingestWorkflowTrace({ id: "t", name: "t", steps: [] })).toThrow(WorkflowIngestError);
  });

  it("rejects a step with an invalid implementation kind", () => {
    expect(() =>
      ingestWorkflowTrace({
        id: "t",
        name: "t",
        steps: [{ id: "a", name: "a", description: "d", implementation: { kind: "bogus" } }],
      }),
    ).toThrow(WorkflowIngestError);
  });

  it("rejects duplicate step ids", () => {
    const step = { id: "a", name: "a", description: "d", implementation: { kind: "code", description: "x" } };
    expect(() => ingestWorkflowTrace({ id: "t", name: "t", steps: [step, step] })).toThrow(WorkflowIngestError);
  });

  it("rejects a dependsOn referencing an unknown step", () => {
    expect(() =>
      ingestWorkflowTrace({
        id: "t",
        name: "t",
        steps: [{ id: "a", name: "a", description: "d", implementation: { kind: "code", description: "x" }, dependsOn: ["missing"] }],
      }),
    ).toThrow(WorkflowIngestError);
  });

  it("round-trips the AP invoice fixture", () => {
    const trace = ingestWorkflowTrace(apInvoiceProcessingTrace);
    expect(trace.steps).toHaveLength(apInvoiceProcessingTrace.steps.length);
  });
});

describe("extractStepsInOrder", () => {
  it("topologically sorts steps by dependsOn", () => {
    const trace = ingestWorkflowTrace({
      id: "t",
      name: "t",
      steps: [
        { id: "c", name: "c", description: "d", implementation: { kind: "code", description: "x" }, dependsOn: ["b"] },
        { id: "b", name: "b", description: "d", implementation: { kind: "code", description: "x" }, dependsOn: ["a"] },
        { id: "a", name: "a", description: "d", implementation: { kind: "code", description: "x" } },
      ],
    });
    const ordered = extractStepsInOrder(trace).map((s) => s.id);
    expect(ordered).toEqual(["a", "b", "c"]);
  });

  it("throws on a cycle", () => {
    const trace = ingestWorkflowTrace({
      id: "t",
      name: "t",
      steps: [
        { id: "a", name: "a", description: "d", implementation: { kind: "code", description: "x" }, dependsOn: ["b"] },
        { id: "b", name: "b", description: "d", implementation: { kind: "code", description: "x" }, dependsOn: ["a"] },
      ],
    });
    expect(() => extractStepsInOrder(trace)).toThrow(WorkflowIngestError);
  });

  it("orders the AP invoice fixture with receive_invoice first and record_payment last", () => {
    const ordered = extractStepsInOrder(apInvoiceProcessingTrace).map((s) => s.id);
    expect(ordered[0]).toBe("receive_invoice");
    expect(ordered[ordered.length - 1]).toBe("record_payment");
  });
});
