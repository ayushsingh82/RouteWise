import { describe, expect, it } from "vitest";
import { buildEvidenceReport, buildEvidenceReportFromCalls, reconcileInvoice, TIER_ORDER } from "./evidence";
import { renderBadge, badgeForReport } from "./badge";
import { renderHtml } from "./html";
import { renderPdf } from "./pdf";
import { generateSupportOpsCalls } from "../ingest/sample-data";
import { anonymizeCalls } from "../ingest/anonymize";
import { apInvoiceProcessingTrace } from "../workflow/fixtures/ap-invoice-processing";
import type { DecisionRecord } from "../gateway/types";

const GEN = "2026-11-27T00:00:00.000Z";

describe("evidence report from fixtures (no recorded traffic)", () => {
  const r = buildEvidenceReport({ trace: apInvoiceProcessingTrace, generatedAt: GEN });
  it("labels everything modeled and says so", () => {
    expect(r.totals.headlineTier).toBe("modeled");
    expect(r.tasks.every((t) => t.tier === "modeled")).toBe(true);
    expect(r.totals.evidenceBackedShare).toBe(0);
    expect(r.caveats.join(" ")).toMatch(/modeled/);
  });
});

describe("evidence report from recorded calls", () => {
  it("upgrades verified tasks to replayed and never claims more than modeled-with-evidence allows", async () => {
    const calls = anonymizeCalls(generateSupportOpsCalls()).calls;
    const r = await buildEvidenceReportFromCalls(calls, { title: "support-ops", generatedAt: GEN });
    const byName = Object.fromEntries(r.tasks.map((t) => [t.name, t]));
    expect(byName.kb_answer.tier).toBe("replayed");
    expect(byName.refund_risk_review.savedUsd).toBe(0);
    expect(r.totals.evidenceBackedShare).toBeGreaterThan(0.3);
    expect(Object.keys(r.totals.byTier)).toEqual(TIER_ORDER);
    expect(Object.values(r.totals.byTier).reduce((a, b) => a + b, 0)).toBeCloseTo(r.totals.savedUsd, 10);
    // evidence-adjusted claim is never silently above what replay supports
    for (const t of r.tasks) if (t.replay && t.tier !== "modeled") expect(t.savedPct).toBeCloseTo(t.replay.savedPct, 10);
  });

  it("withholds savings for a task whose replay diverged", async () => {
    const calls = generateSupportOpsCalls();
    const kb = calls.filter((c) => c.task === "kb_answer");
    const rigged = calls.map((c) => (c.task === "kb_answer" && kb.indexOf(c) >= 24 ? { ...c, output: "different" } : c));
    const r = await buildEvidenceReportFromCalls(rigged, { generatedAt: GEN });
    const t = r.tasks.find((x) => x.name === "kb_answer")!;
    expect(t.savedUsd).toBe(0);
    expect(t.caveats.join(" ")).toMatch(/Do not enforce/);
  });
});

describe("live ledger + invoice", () => {
  const rec = (i: number, saved: boolean): DecisionRecord => ({ id: `${i}`, ts: i, task: "kb_answer", taskKey: "k", action: saved ? "cache-hit" : "passthrough", classification: "cacheable", confidence: 0.85, requestedModel: "m", usedModel: "m", baselineUsd: 0.01, policyUsd: saved ? 0 : 0.01, inputTokens: 1, outputTokens: 1, verification: "n/a", enforced: true });
  const ledger = Array.from({ length: 40 }, (_, i) => rec(i, i % 2 === 0));

  it("reconciles ledger spend to an invoice", () => {
    expect(reconcileInvoice(ledger, { billedUsd: 0.2 }).matched).toBe(true);
    expect(reconcileInvoice(ledger, { billedUsd: 0.3 }).matched).toBe(false);
  });

  it("measured tier needs enough live calls; invoice match promotes to verified", () => {
    const trace = apInvoiceProcessingTrace;
    const base = { trace, stepKeys: { [trace.steps[0].id]: "k" }, ledger, generatedAt: GEN };
    const model = trace.steps.find((s) => s.implementation.kind === "model")!;
    const keyed = { ...base, stepKeys: { [model.id]: "k" } };
    expect(buildEvidenceReport(keyed).tasks.find((t) => t.stepId === model.id)!.tier).toBe("measured");
    expect(buildEvidenceReport({ ...keyed, invoice: { billedUsd: 0.2 } }).tasks.find((t) => t.stepId === model.id)!.tier).toBe("verified");
    expect(buildEvidenceReport({ ...keyed, invoice: { billedUsd: 5 } }).tasks.find((t) => t.stepId === model.id)!.tier).toBe("measured");
  });
});

describe("renderers", () => {
  const r = buildEvidenceReport({ trace: apInvoiceProcessingTrace, generatedAt: GEN });
  it("badge states the tier and escapes text", () => {
    const svg = renderBadge({ pct: 0.634, tier: "replayed", label: 'a<b>"' });
    expect(svg).toContain("63% · replayed");
    expect(svg).toContain("a&lt;b&gt;&quot;");
    expect(badgeForReport(r)).toContain("modeled");
  });
  it("html is self-contained, escaped, and carries the caveats", () => {
    const html = renderHtml({ ...r, title: "<script>alert(1)</script>" });
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("Evidence tier");
    expect(html).not.toMatch(/src="http|href="http/);
  });
  it("pdf is a valid, multi-section PDF", async () => {
    const full = await buildEvidenceReportFromCalls(generateSupportOpsCalls(), { generatedAt: GEN });
    const bytes = await renderPdf(full);
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    expect(bytes.length).toBeGreaterThan(3000);
  });
});
