import { describe, expect, it, vi } from "vitest";
import {
  classifyStepWithFallback,
  classifyTraceWithFallback,
  type ModelClassifier,
  type ModelClassifierInput,
  type ModelClassifierOutput,
} from "./classify-model";
import { supportTicketTriageTrace } from "./fixtures/support-ticket-triage";
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

describe("classifyStepWithFallback", () => {
  it("does not call the model when a rule already confidently matched", async () => {
    const modelClassifier: ModelClassifier = vi.fn();
    const result = await classifyStepWithFallback(step({ implementation: { kind: "code", description: "x" } }), modelClassifier);
    expect(result.classification).toBe("deterministic");
    expect(modelClassifier).not.toHaveBeenCalled();
  });

  it("calls the model only for steps the rules left at fallback confidence", async () => {
    const modelClassifier: ModelClassifier = vi.fn().mockResolvedValue({
      classification: "simple-judgment",
      confidence: 0.7,
      rationale: "Bounded sentiment/urgency scale, a small model can do this reliably.",
    });
    const unmatched = step({ name: "assess_sentiment_urgency", description: "gauge tone" });
    const result = await classifyStepWithFallback(unmatched, modelClassifier);

    expect(modelClassifier).toHaveBeenCalledTimes(1);
    expect(result.classification).toBe("simple-judgment");
    expect(result.confidence).toBe(0.7);
    expect(result.signals).toContain("fallback:model-classified");
  });

  it("falls back to the rules result if the model classifier throws", async () => {
    const modelClassifier: ModelClassifier = vi.fn().mockRejectedValue(new Error("rate limited"));
    const unmatched = step({ name: "mystery_step", description: "do something inscrutable" });
    const result = await classifyStepWithFallback(unmatched, modelClassifier);

    expect(result.classification).toBe("complex-judgment");
    expect(result.signals).toContain("fallback:model-error");
    expect(result.rationale).toContain("rate limited");
  });

  it("respects a custom fallbackBelowConfidence threshold", async () => {
    const modelClassifier: ModelClassifier = vi.fn().mockResolvedValue({
      classification: "cacheable",
      confidence: 0.6,
      rationale: "override",
    });
    // gl-code-style categorization rule matches at confidence 0.75 — with a threshold of 0.8
    // that should now be treated as unconfident enough to fall back to the model.
    const categorization = step({ name: "gl_code_line_item", description: "Assign a GL code to each line item" });
    const result = await classifyStepWithFallback(categorization, modelClassifier, { fallbackBelowConfidence: 0.8 });

    expect(modelClassifier).toHaveBeenCalledTimes(1);
    expect(result.classification).toBe("cacheable");
    expect(result.rationale).toBe("override");
  });
});

describe("classifyTraceWithFallback on the support-ticket-triage fixture", () => {
  it("closes the rule-coverage gap for sentiment/urgency and reply-drafting via the mock model", async () => {
    const modelClassifier: ModelClassifier = vi.fn(async ({ step }: ModelClassifierInput): Promise<ModelClassifierOutput> => {
      if (step.id === "assess_sentiment_urgency" || step.id === "draft_reply") {
        return { classification: "simple-judgment", confidence: 0.65, rationale: "Bounded, well-templated task." };
      }
      return { classification: "complex-judgment", confidence: 0.3, rationale: "Genuinely unclear." };
    });

    const classifications = await classifyTraceWithFallback(supportTicketTriageTrace, modelClassifier);
    const sentiment = classifications.find((c) => c.stepId === "assess_sentiment_urgency")!;
    const draft = classifications.find((c) => c.stepId === "draft_reply")!;
    const risk = classifications.find((c) => c.stepId === "assess_account_risk")!;

    expect(sentiment.classification).toBe("simple-judgment");
    expect(draft.classification).toBe("simple-judgment");
    // A step the rules already classified confidently (high-stakes keywords) must not hit the model at all.
    expect(risk.classification).toBe("complex-judgment");
    expect(risk.signals).not.toContain("fallback:model-classified");
  });
});
