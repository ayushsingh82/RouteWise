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
 * *doesn't* apply. See `classify.ts`'s "context-sensitivity-override" rule,
 * added in response to what this fixture found.
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

  it("documents a blind spot: a numeric (non-boolean) threshold score falls through every rule to the safe default", () => {
    // score_toxicity is a textbook fixed-threshold rule (a 0-100 rubric score), but
    // outputLooksLikeSmallEnum only recognizes boolean/BOOLEAN_LIKE-string outputs, so
    // the fixed-rule-or-threshold rule never fires here. Falls to the conservative
    // default instead of being caught as deterministic or even simple-judgment —
    // safe, but real missed savings; a future rule could special-case bounded numeric
    // ranges the way outputLooksLikeSmallEnum does booleans.
    const classifications = classifyTrace(contentModerationQueueTrace);
    const step = classifications.find((c) => c.stepId === "score_toxicity")!;
    expect(step.classification).toBe("complex-judgment");
    expect(step.signals).toContain("fallback:no-rule-matched");
  });

  it("documents a blind spot: a nested multi-field decision object also evades the small-enum output check", () => {
    // decide_action is a pure policy-table lookup (score x category -> {action, reason}),
    // but its object-shaped output means outputLooksLikeSmallEnum can't recognize it as
    // deterministic either. It still gets classified cacheable, but via an unrelated
    // keyword collision ("content category" in the prose, not what the step does) rather
    // than the correct, higher-confidence deterministic path.
    const classifications = classifyTrace(contentModerationQueueTrace);
    const step = classifications.find((c) => c.stepId === "decide_action")!;
    expect(step.classification).toBe("cacheable");
    expect(step.signals).toContain("keyword:categorization");
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
