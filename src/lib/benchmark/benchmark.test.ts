import { describe, expect, it } from "vitest";
import { benchmarkTask, casesFromCalls, recordedCandidate, wilsonLowerBound, type Candidate } from "./benchmark";
import { scoreOutput } from "./score";
import { generateSupportOpsCalls } from "../ingest/sample-data";

describe("scoreOutput", () => {
  it("json: all reference fields must match, order and case insensitive", () => {
    expect(scoreOutput('{"a":"X","b":1}', '{"b":1,"a":"x"}').pass).toBe(true);
    const partial = scoreOutput('{"a":"x","b":1}', '{"a":"x","b":2}');
    expect(partial).toMatchObject({ score: 0.5, pass: false, mode: "json" });
    expect(scoreOutput('{"a":1}', "not json").score).toBe(0);
    expect(scoreOutput('{"a":1}', '```json\n{"a":1}\n```').pass).toBe(true);
  });
  it("exact for short text, token-f1 for long", () => {
    expect(scoreOutput("Approved", " approved ").mode).toBe("exact");
    const long = "You can download any invoice as a PDF from the billing page under invoices and choose download";
    expect(scoreOutput(long, long).mode).toBe("token-f1");
    expect(scoreOutput(long, "Totally unrelated words here").pass).toBe(false);
  });
});

describe("wilsonLowerBound", () => {
  it("is much lower than the raw rate on small samples", () => {
    expect(wilsonLowerBound(9, 10)).toBeLessThan(0.65);
    expect(wilsonLowerBound(95, 100)).toBeGreaterThan(0.88);
    expect(wilsonLowerBound(0, 0)).toBe(0);
  });
});

describe("benchmarkTask", () => {
  const cases = Array.from({ length: 40 }, (_, i) => ({ id: `c${i}`, task: "t", taskKey: "t|", input: `in ${i}`, reference: '{"label":"a"}', referenceKind: "frontier-recorded" as const }));
  const cand = (id: string, tier: Candidate["tier"], okRate: number): Candidate => ({
    id, tier, model: id,
    run: async (c) => ({ output: Number(c.id.slice(1)) / 40 < okRate ? '{"label":"a"}' : '{"label":"b"}', inputTokens: 100, outputTokens: 10 }),
  });

  it("recommends the cheapest candidate that clears the threshold on its lower bound", async () => {
    const r = await benchmarkTask(cases, [cand("small", "non-frontier", 0.75), cand("mid", "near-frontier", 1)]);
    expect(r.recommended?.candidateId).toBe("mid");
    expect(r.results[0].passRate).toBeCloseTo(0.75);
  });

  it("recommends nothing when no candidate is good enough, and doesn't trust tiny samples", async () => {
    const tiny = await benchmarkTask(cases.slice(0, 5), [cand("small", "non-frontier", 1)]);
    expect(tiny.recommended).toBeNull(); // 5/5 is only ~0.57 lower bound
  });

  it("a throwing candidate counts as failures, not a crash", async () => {
    const bad: Candidate = { id: "x", tier: "non-frontier", model: "x", run: async () => { throw new Error("boom"); } };
    const r = await benchmarkTask(cases, [bad]);
    expect(r.results[0].passed).toBe(0);
  });
});

describe("offline benchmark from a recorded trace", () => {
  it("uses the team's own A/B run: triage on mini agrees with gpt-4o on most cases", async () => {
    const calls = generateSupportOpsCalls();
    const byTask = casesFromCalls(calls, { limit: 100 });
    const key = [...byTask.entries()].find(([, v]) => v[0].task === "ticket_triage")![0];
    const cands = recordedCandidate(calls, "non-frontier");
    const r = await benchmarkTask(byTask.get(key)!, [cands], { threshold: 0.7 });
    expect(r.referenceKind).toBe("frontier-recorded");
    expect(r.results[0].evaluated).toBeGreaterThan(3);
    expect(r.results[0].skipped).toBeGreaterThan(0); // most cases were never run on the cheap model
    expect(r.results[0].passRate).toBeGreaterThan(0.6);
  });

  it("a tier never vouches for itself: same-tier recorded answers are not evidence", async () => {
    const calls = generateSupportOpsCalls();
    const byTask = casesFromCalls(calls);
    const key = [...byTask.entries()].find(([, v]) => v[0].task === "sentiment_urgency")![0];
    const r = await benchmarkTask(byTask.get(key)!, [recordedCandidate(calls, "near-frontier")]);
    expect(r.results[0].evaluated).toBe(0);
    expect(r.recommended).toBeNull();
  });
});
