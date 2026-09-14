import { describe, expect, it } from "vitest";
import { estimateTokensFromValue, resolveStepTokens } from "./tokens";
import type { WorkflowStep } from "./types";

describe("estimateTokensFromValue", () => {
  it("estimates ~4 chars per token (JSON-encoded, so a quoted string adds 2 chars)", () => {
    expect(estimateTokensFromValue("a".repeat(40))).toBe(Math.ceil((40 + 2) / 4));
  });

  it("handles undefined/null as empty", () => {
    expect(estimateTokensFromValue(undefined)).toBe(estimateTokensFromValue(""));
    expect(estimateTokensFromValue(null)).toBeGreaterThanOrEqual(0);
  });
});

describe("resolveStepTokens", () => {
  it("prefers observed token counts when present", () => {
    const step: WorkflowStep = {
      id: "s",
      name: "s",
      description: "",
      implementation: { kind: "model", model: "frontier" },
      inputs: [{ name: "x", value: "a".repeat(400) }],
      outputs: [],
      dependsOn: [],
      observedCost: { inputTokens: 111, outputTokens: 22 },
    };
    const result = resolveStepTokens(step);
    expect(result).toEqual({ inputTokens: 111, outputTokens: 22, source: "observed" });
  });

  it("falls back to estimating from inputs/outputs when no observed tokens", () => {
    const step: WorkflowStep = {
      id: "s",
      name: "s",
      description: "",
      implementation: { kind: "model", model: "frontier" },
      inputs: [{ name: "x", value: "a".repeat(40) }],
      outputs: [{ name: "y", value: "b".repeat(40) }],
      dependsOn: [],
    };
    const result = resolveStepTokens(step);
    expect(result.source).toBe("estimated");
    expect(result.inputTokens).toBeGreaterThan(0);
    expect(result.outputTokens).toBeGreaterThan(0);
  });
});
