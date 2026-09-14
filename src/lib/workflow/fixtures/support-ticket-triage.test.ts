import { describe, expect, it } from "vitest";
import { ingestWorkflowTrace, extractStepsInOrder } from "../ingest";
import { classifyTrace, summarizeClassification } from "../classify";
import { routeTrace, summarizeRouting } from "../router";
import { assessWorkflowHealth } from "../health";
import { computeTraceSavings } from "../savings";
import { supportTicketTriageTrace } from "./support-ticket-triage";

/**
 * Generalization check (PLAN.md "Next up" #2): validates the full pipeline
 * against a second, structurally different workflow (free-text sentiment
 * calls, a refund policy check, no invoice/GL vocabulary at all) so the
 * classifier's heuristics aren't accidentally tuned to the AP invoice fixture.
 */
describe("pipeline against the support-ticket-triage fixture", () => {
  it("ingests and topologically orders cleanly", () => {
    const trace = ingestWorkflowTrace(supportTicketTriageTrace);
    const ordered = extractStepsInOrder(trace).map((s) => s.id);
    expect(ordered[0]).toBe("receive_ticket");
    expect(ordered[ordered.length - 1]).toBe("send_reply");
  });

  it("correctly identifies the fixed-policy refund check and the two lookup/mapping steps as downgrade candidates", () => {
    const classifications = classifyTrace(supportTicketTriageTrace);
    const summary = summarizeClassification(supportTicketTriageTrace, classifications);
    const ids = summary.downgradeCandidates.map((c) => c.stepId).sort();
    expect(ids).toEqual(["check_known_issue", "check_refund_eligibility", "classify_topic"]);
  });

  it("keeps the genuinely high-stakes account-risk step on complex-judgment", () => {
    const classifications = classifyTrace(supportTicketTriageTrace);
    const risk = classifications.find((c) => c.stepId === "assess_account_risk")!;
    expect(risk.classification).toBe("complex-judgment");
    expect(risk.signals).toContain("keyword:high-stakes");
  });

  it("documents a rule-coverage gap: sentiment/urgency and reply-drafting fall through to the conservative default instead of simple-judgment", () => {
    // Neither step matches any DEFAULT_RULES pattern (no policy/threshold/categorization/
    // extraction keywords), so both land on the safe fallback rather than being recognized
    // as bounded small-model tasks. Correct per "escalate, don't under-classify" — but it's
    // a real heuristic gap this second fixture surfaced, worth a future rule (or the
    // prompt-based fallback) rather than silently accepting the escalation.
    const classifications = classifyTrace(supportTicketTriageTrace);
    const sentiment = classifications.find((c) => c.stepId === "assess_sentiment_urgency")!;
    const draft = classifications.find((c) => c.stepId === "draft_reply")!;
    expect(sentiment.classification).toBe("complex-judgment");
    expect(sentiment.signals).toContain("fallback:no-rule-matched");
    expect(draft.classification).toBe("complex-judgment");
    expect(draft.signals).toContain("fallback:no-rule-matched");
  });

  it("flags the trace as a decomposition candidate (majority of steps still model calls)", () => {
    const classifications = classifyTrace(supportTicketTriageTrace);
    const health = assessWorkflowHealth(supportTicketTriageTrace, classifications);
    expect(health.isDecompositionCandidate).toBe(true);
    expect(health.modelStepShare).toBeCloseTo(6 / 9);
  });

  it("routes without escalation under the default policy and produces positive savings", () => {
    const classifications = classifyTrace(supportTicketTriageTrace);
    const decisions = routeTrace(supportTicketTriageTrace, classifications);
    expect(decisions.some((d) => d.escalated)).toBe(false);
    const routing = summarizeRouting(decisions);
    expect(routing.totalSteps).toBe(supportTicketTriageTrace.steps.length);

    const savings = computeTraceSavings(supportTicketTriageTrace, classifications);
    expect(savings.totals.savingsVsNaiveFrontierPct).toBeGreaterThan(0);
    // Lower than the AP fixture's ~52%: three complex-judgment fallback steps
    // (the rule-coverage gap above) stay on frontier and dominate spend here.
    expect(savings.totals.savingsVsNaiveFrontierPct).toBeLessThan(0.45);
  });
});
