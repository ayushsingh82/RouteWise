import { describe, expect, it } from "vitest";
import { ingestWorkflowTrace, extractStepsInOrder } from "../ingest";
import { classifyTrace } from "../classify";
import { routeTrace } from "../router";
import { assessWorkflowHealth } from "../health";
import { computeTraceSavings } from "../savings";
import { contentModerationQueueTrace } from "./content-moderation-queue";

/**
 * Third target workflow (PLAN.md "Next up" #3): adversarial fixture designed
 * to stress `classify.ts`'s output-shape heuristics — a numeric (non-boolean)
 * threshold score, a nested multi-field decision object, and a step whose
 * description mentions "policy"/"threshold" only to explain why a fixed rule
 * *doesn't* apply. All three found real gaps, each now fixed in classify.ts:
 * "context-sensitivity-override", "bounded-scoring-rubric", and the
 * small-object case in `outputLooksLikeSmallEnum`, respectively.
 */
describe("pipeline against the content-moderation-queue fixture", () => {
  it("ingests and topologically orders cleanly", () => {
    const trace = ingestWorkflowTrace(contentModerationQueueTrace);
    const ordered = extractStepsInOrder(trace).map((s) => s.id);
    expect(ordered[0]).toBe("receive_post");
    expect(ordered[ordered.length - 1]).toBe("apply_action");
  });

  it("regression: does not misclassify a context-dependent judgment step as deterministic just because it mentions a threshold and returns a boolean", () => {
    // assess_borderline_context is explicitly about weighing nuance a fixed score
    // "can't capture" — before the context-sensitivity-override rule existed, the
    // fixed-rule-or-threshold rule fired on the incidental "policy threshold" mention
    // + boolean output and classified this deterministic at 0.8 confidence. That's
    // the unsafe direction: a judgment call silently downgraded to plain code.
    const classifications = classifyTrace(contentModerationQueueTrace);
    const step = classifications.find((c) => c.stepId === "assess_borderline_context")!;
    expect(step.classification).toBe("complex-judgment");
    expect(step.signals).toContain("keyword:context-override");
  });

  it("regression: a numeric threshold score gets caught by bounded-scoring-rubric instead of falling to the safe default", () => {
    // score_toxicity assigns a 0-100 rubric score -- a judgment call about *what* the
    // score should be, not a rule lookup, so it must land on simple-judgment (a small
    // model), never deterministic. Before the bounded-scoring-rubric rule existed, this
    // fell all the way to the conservative complex-judgment default: safe, but real
    // missed savings for a task well within a small model's reach.
    const classifications = classifyTrace(contentModerationQueueTrace);
    const step = classifications.find((c) => c.stepId === "score_toxicity")!;
    expect(step.classification).toBe("simple-judgment");
    expect(step.signals).toContain("keyword:bounded-scoring-rubric");
  });

  it("regression: a nested multi-field decision object is now recognized as a small-enum output", () => {
    // decide_action is a pure policy-table lookup (score x category -> {action, reason}).
    // Before outputLooksLikeSmallEnum recognized small object outputs, this fell through
    // fixed-rule-or-threshold and got classified cacheable via an unrelated keyword
    // collision ("content category" in the prose, not what the step does) instead of the
    // correct, higher-confidence deterministic path.
    const classifications = classifyTrace(contentModerationQueueTrace);
    const step = classifications.find((c) => c.stepId === "decide_action")!;
    expect(step.classification).toBe("deterministic");
    expect(step.signals).toEqual(expect.arrayContaining(["keyword:policy-or-threshold", "output:small-enum"]));
  });

  it("flags the trace as a decomposition candidate", () => {
    const classifications = classifyTrace(contentModerationQueueTrace);
    const health = assessWorkflowHealth(contentModerationQueueTrace, classifications);
    expect(health.isDecompositionCandidate).toBe(true);
  });

  it("routes without escalation under the default policy and produces positive savings", () => {
    const classifications = classifyTrace(contentModerationQueueTrace);
    const decisions = routeTrace(contentModerationQueueTrace, classifications);
    expect(decisions.some((d) => d.escalated)).toBe(false);

    const savings = computeTraceSavings(contentModerationQueueTrace, classifications);
    expect(savings.totals.savingsVsNaiveFrontierPct).toBeGreaterThan(0);
    expect(savings.totals.recommendedUsd).toBeLessThanOrEqual(savings.totals.currentUsd);
  });
});
