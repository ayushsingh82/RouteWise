import { describe, expect, it, vi } from "vitest";
import { createAnthropicClassifier } from "./anthropic-classifier";
import type { ModelClassifierInput } from "../classify-model";
import type { WorkflowStep } from "../types";

function step(overrides: Partial<WorkflowStep>): WorkflowStep {
  return {
    id: "assess_sentiment_urgency",
    name: "assess_sentiment_urgency",
    description: "Read the ticket's tone and content to gauge how upset/urgent the customer is.",
    implementation: { kind: "model", model: "frontier" },
    inputs: [{ name: "message.raw", value: "<inbound email>" }],
    outputs: [{ name: "ticket.priority", value: "normal" }],
    dependsOn: [],
    ...overrides,
  };
}

function fakeAnthropicClient(parsedOutput: unknown) {
  return {
    messages: {
      parse: vi.fn().mockResolvedValue({ parsed_output: parsedOutput }),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("createAnthropicClassifier", () => {
  it("sends a prompt describing the step and returns the parsed classification", async () => {
    const client = fakeAnthropicClient({
      classification: "simple-judgment",
      confidence: 0.65,
      rationale: "Bounded sentiment/urgency scale.",
    });
    const classifier = createAnthropicClassifier({ client });

    const input: ModelClassifierInput = {
      step: step({}),
      ruleResult: {
        stepId: "assess_sentiment_urgency",
        classification: "complex-judgment",
        confidence: 0.3,
        rationale: "No classification rule matched; defaulting to the safe/expensive tier rather than guessing a downgrade.",
        signals: ["fallback:no-rule-matched"],
      },
    };

    const result = await classifier(input);

    expect(result).toEqual({
      classification: "simple-judgment",
      confidence: 0.65,
      rationale: "Bounded sentiment/urgency scale.",
    });
    expect(client.messages.parse).toHaveBeenCalledTimes(1);
    const callArgs = client.messages.parse.mock.calls[0][0];
    expect(callArgs.messages[0].content).toContain("assess_sentiment_urgency");
    expect(callArgs.messages[0].content).toContain(input.ruleResult.rationale);
  });

  it("defaults to claude-opus-5 when no model is specified", async () => {
    const client = fakeAnthropicClient({ classification: "deterministic", confidence: 0.9, rationale: "x" });
    const classifier = createAnthropicClassifier({ client });
    await classifier({
      step: step({}),
      ruleResult: { stepId: "s", classification: "complex-judgment", confidence: 0.3, rationale: "r", signals: [] },
    });
    expect(client.messages.parse.mock.calls[0][0].model).toBe("claude-opus-5");
  });

  it("respects a custom model override", async () => {
    const client = fakeAnthropicClient({ classification: "deterministic", confidence: 0.9, rationale: "x" });
    const classifier = createAnthropicClassifier({ client, model: "claude-haiku-4-5" });
    await classifier({
      step: step({}),
      ruleResult: { stepId: "s", classification: "complex-judgment", confidence: 0.3, rationale: "r", signals: [] },
    });
    expect(client.messages.parse.mock.calls[0][0].model).toBe("claude-haiku-4-5");
  });

  it("throws if the API returns no parsed output", async () => {
    const client = fakeAnthropicClient(null);
    const classifier = createAnthropicClassifier({ client });
    await expect(
      classifier({
        step: step({}),
        ruleResult: { stepId: "s", classification: "complex-judgment", confidence: 0.3, rationale: "r", signals: [] },
      }),
    ).rejects.toThrow(/unparseable/);
  });
});
