import { resolveTier, priceTokens, DEFAULT_PRICING, type ResourceTier, type TierPricing } from "../workflow/pricing";
import { estimateTokens } from "../ingest/util";
import { normalizeInput, taskKey } from "../ingest/to-trace-shared";
import type { CallRecord } from "../ingest/types";
import { scoreOutput, type Score, type ScoreMode } from "./score";

/**
 * Phase 2.4 — per-task benchmarking. For one task, run labeled cases through
 * each candidate (a cheaper tier/model) and measure how often it reproduces
 * the reference answer; recommend the cheapest candidate whose pass rate is
 * *statistically* good enough (Wilson lower bound, not the raw rate — 9/10 is
 * not evidence of 95%).
 *
 * Labels come from one of two places, and the report says which:
 *  - "human":            reference answers you supplied
 *  - "frontier-recorded": the answers your current (frontier) model actually gave in production.
 *    That measures *agreement with today's behavior*, not truth, and is labeled as such.
 */

export interface BenchmarkCase {
  id: string;
  task: string;
  taskKey: string;
  system?: string;
  input: string;
  reference: string;
  referenceKind: "human" | "frontier-recorded";
  /** Tier of the model that produced `reference` (recorded-trace cases only). */
  referenceTier?: ResourceTier;
}

export interface RunnerResult {
  output: string;
  inputTokens?: number;
  outputTokens?: number;
}

export interface Candidate {
  id: string;
  tier: ResourceTier;
  model: string;
  /** Returns null when this candidate has no answer for the case (e.g. offline replay with no recorded output). */
  run: (c: BenchmarkCase) => Promise<RunnerResult | null>;
}

export interface CandidateResult {
  candidateId: string;
  tier: ResourceTier;
  model: string;
  evaluated: number;
  skipped: number;
  passed: number;
  passRate: number;
  /** 95% Wilson lower bound on the true pass rate. */
  passRateLowerBound: number;
  meanScore: number;
  costUsd: number;
  failures: { caseId: string; reference: string; output: string; score: number }[];
}

export interface TaskBenchmark {
  task: string;
  taskKey: string;
  cases: number;
  referenceKind: BenchmarkCase["referenceKind"];
  threshold: number;
  results: CandidateResult[];
  /** Cheapest candidate whose lower bound clears the threshold, or null if none did. */
  recommended: CandidateResult | null;
}

export function wilsonLowerBound(passed: number, n: number, z = 1.96): number {
  if (n === 0) return 0;
  const p = passed / n;
  const denom = 1 + (z * z) / n;
  const center = p + (z * z) / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n);
  return Math.max(0, (center - margin) / denom);
}

export interface BenchmarkOptions {
  /** Required (lower-bound) pass rate. Default 0.9. */
  threshold?: number;
  scoreMode?: ScoreMode;
  /** Replace the built-in scorer, e.g. with an LLM judge for open-ended prose. */
  judge?: (c: BenchmarkCase, output: string) => Promise<Score> | Score;
  pricing?: Record<ResourceTier, TierPricing>;
  concurrency?: number;
}

const TIER_ORDER: ResourceTier[] = ["non-frontier", "near-frontier", "frontier"];

async function pool<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

export async function benchmarkTask(cases: BenchmarkCase[], candidates: Candidate[], opts: BenchmarkOptions = {}): Promise<TaskBenchmark> {
  if (cases.length === 0) throw new Error("benchmarkTask needs at least one case");
  const threshold = opts.threshold ?? 0.9;
  const pricing = opts.pricing ?? DEFAULT_PRICING;

  const results: CandidateResult[] = [];
  for (const cand of candidates) {
    const outcomes = await pool(cases, opts.concurrency ?? 4, async (c) => {
      try {
        const r = await cand.run(c);
        if (!r) return null;
        const s = opts.judge ? await opts.judge(c, r.output) : scoreOutput(c.reference, r.output, opts.scoreMode);
        return { c, r, s };
      } catch {
        return { c, r: { output: "" }, s: { score: 0, pass: false, mode: "exact" as const } };
      }
    });
    const done = outcomes.filter((o): o is NonNullable<typeof o> => o !== null);
    const passed = done.filter((o) => o.s.pass).length;
    results.push({
      candidateId: cand.id,
      tier: cand.tier,
      model: cand.model,
      evaluated: done.length,
      skipped: cases.length - done.length,
      passed,
      passRate: done.length ? passed / done.length : 0,
      passRateLowerBound: wilsonLowerBound(passed, done.length),
      meanScore: done.length ? done.reduce((s, o) => s + o.s.score, 0) / done.length : 0,
      costUsd: done.reduce((s, o) => s + priceTokens(cand.tier, o.r.inputTokens ?? estimateTokens(`${o.c.system ?? ""}${o.c.input}`), o.r.outputTokens ?? estimateTokens(o.r.output), pricing), 0),
      failures: done.filter((o) => !o.s.pass).slice(0, 5).map((o) => ({ caseId: o.c.id, reference: o.c.reference.slice(0, 200), output: o.r.output.slice(0, 200), score: o.s.score })),
    });
  }

  const eligible = results.filter((r) => r.evaluated > 0 && r.passRateLowerBound >= threshold).sort((a, b) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier));
  return { task: cases[0].task, taskKey: cases[0].taskKey, cases: cases.length, referenceKind: cases[0].referenceKind, threshold, results, recommended: eligible[0] ?? null };
}

/**
 * Builds benchmark cases from recorded traffic: one case per distinct
 * (task, input), with the reference taken from the highest-tier model that
 * answered it. Deterministic: first `limit` cases in trace order.
 */
export function casesFromCalls(calls: CallRecord[], opts: { limit?: number; minTier?: ResourceTier } = {}): Map<string, BenchmarkCase[]> {
  const rank = (m: string) => TIER_ORDER.indexOf(resolveTier(m));
  const best = new Map<string, CallRecord>();
  for (const c of calls) {
    if (c.input === "" || c.output === "") continue;
    const k = `${taskKey(c)}\u0000${normalizeInput(c.input)}`;
    const cur = best.get(k);
    if (!cur || rank(c.model) > rank(cur.model)) best.set(k, c);
  }
  const byTask = new Map<string, BenchmarkCase[]>();
  for (const [k, c] of best) {
    if (opts.minTier && rank(c.model) < TIER_ORDER.indexOf(opts.minTier)) continue;
    const key = k.split("\u0000")[0];
    const list = byTask.get(key) ?? [];
    if (list.length >= (opts.limit ?? 50)) continue;
    list.push({ id: c.id, task: c.task ?? key, taskKey: key, system: c.system, input: c.input, reference: c.output, referenceKind: "frontier-recorded", referenceTier: resolveTier(c.model) });
    byTask.set(key, list);
  }
  return byTask;
}

/**
 * An offline candidate that answers from what a given tier *already said* in
 * the recorded trace (A/B runs, evals, fallbacks). No network, no spend; cases
 * the tier never saw are skipped, so `evaluated` shows the real coverage.
 */
export function recordedCandidate(calls: CallRecord[], tier: ResourceTier): Candidate {
  const answers = new Map<string, CallRecord>();
  for (const c of calls) if (resolveTier(c.model) === tier) answers.set(`${taskKey(c)}\u0000${normalizeInput(c.input)}`, c);
  const sample = calls.find((c) => resolveTier(c.model) === tier);
  return {
    id: `recorded:${tier}`,
    tier,
    model: sample?.model ?? tier,
    run: async (c) => {
      // A tier can't vouch for itself: only strictly cheaper answers are evidence about a downgrade.
      if (c.referenceTier !== undefined && TIER_ORDER.indexOf(tier) >= TIER_ORDER.indexOf(c.referenceTier)) return null;
      const hit = answers.get(`${c.taskKey}\u0000${normalizeInput(c.input)}`);
      return hit ? { output: hit.output, inputTokens: hit.inputTokens, outputTokens: hit.outputTokens } : null;
    },
  };
}
