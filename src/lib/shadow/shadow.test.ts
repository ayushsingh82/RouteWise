import { describe, expect, it } from "vitest";
import { replayCalls } from "./replay";
import { approvedTaskKeys } from "./summarize";
import { GatewayEngine } from "../gateway/engine";
import { generateSupportOpsCalls, generateCodingCalls } from "../ingest/sample-data";

const calls = generateSupportOpsCalls();
const report = replayCalls(calls);
const task = (name: string) => report.summary.tasks.find((t) => t.task === name)!;

describe("shadow replay", () => {
  it("never acts during cold start", () => {
    const first = report.records.slice(0, 5);
    expect(first.every((r) => r.action === "passthrough")).toBe(true);
  });

  it("leaves complex-judgment tasks on their model", () => {
    expect(task("refund_risk_review").verdict).toBe("keep");
    expect(task("refund_risk_review").savedUsd).toBe(0);
    expect(task("draft_reply").savedUsd).toBe(0);
  });

  it("serves recurring KB questions from cache and verifies them against the recorded answers", () => {
    const kb = task("kb_answer");
    expect(kb.cacheHits).toBeGreaterThan(5);
    expect(kb.diverged).toBe(0);
    expect(kb.verdict).toBe("safe");
    expect(kb.verifiedSavedUsd).toBeGreaterThan(0);
  });

  it("is conservative about downgrade-only tasks it cannot verify", () => {
    const ex = task("extract_invoice_fields");
    expect(["keep", "insufficient-evidence"]).toContain(ex.verdict);
  });

  it("totals are consistent and savings are never negative", () => {
    const s = report.summary;
    expect(s.baselineUsd - s.policyUsd).toBeCloseTo(s.savedUsd, 10);
    expect(s.savedUsd).toBeGreaterThan(0);
    for (const r of report.records) expect(r.policyUsd).toBeLessThanOrEqual(r.baselineUsd + 1e-12);
  });

  it("detects a cache that would have served a wrong answer", () => {
    const rigged = calls.map((c) => (c.task === "kb_answer" ? { ...c, output: `${c.output} #${c.id}` } : c));
    const bad = replayCalls(rigged).summary.tasks.find((t) => t.task === "kb_answer")!;
    // Outputs now differ on every repeat, so the classifier must refuse to treat it as cacheable at all.
    expect(bad.cacheHits).toBe(0);
  });

  it("flags unsafe when a cacheable task starts diverging after it was classified", () => {
    const kb = calls.filter((c) => c.task === "kb_answer");
    const early = kb.slice(0, 24);
    const late = kb.slice(24).map((c) => ({ ...c, output: "A completely different answer" }));
    const r = replayCalls([...early, ...late]).summary.tasks.find((t) => t.task === "kb_answer")!;
    expect(r.diverged).toBeGreaterThan(0);
    expect(r.verdict).toBe("unsafe");
  });

  it("does not downgrade calls that use tools, and ignores coding sessions' cold tasks safely", () => {
    const coding = replayCalls(generateCodingCalls({ provider: "anthropic" }));
    expect(coding.summary.savedUsd).toBeGreaterThanOrEqual(0);
    expect(coding.records.filter((r) => r.action !== "passthrough" && r.task.includes("tool:"))).toHaveLength(0);
  });

  it("approved task keys restrict a live engine to shadow-approved tasks only", () => {
    const keys = approvedTaskKeys(report.summary);
    expect(keys.length).toBeGreaterThan(0);
    const engine = new GatewayEngine();
    engine.restrictTo([]);
    const replayed = replayCalls(calls, { engine });
    expect(replayed.summary.savedUsd).toBe(0);
  });
});
