import type { TaskClassification, WorkflowTrace } from "../workflow/types";
import { classifyTrace, type StepClassification } from "../workflow/classify";
import { computeTraceSavings, DEFAULT_ASSUMPTIONS, type SavingsAssumptions, type TraceSavingsReport } from "../workflow/savings";
import { DEFAULT_PRICING } from "../workflow/pricing";
import type { CallRecord } from "../ingest/types";
import { callsToWorkflowTrace, groupCallsByTask } from "../ingest/to-trace";
import { CACHED_INPUT_DISCOUNT } from "../ingest/to-trace-shared";
import type { AnonymizationReport } from "../ingest/anonymize";
import { replayCalls } from "../shadow/replay";
import { summarizeDecisions, type ShadowSummary, type TaskShadowSummary } from "../shadow/summarize";
import type { DecisionRecord } from "../gateway/types";
import { benchmarkTask, casesFromCalls, recordedCandidate, type TaskBenchmark } from "../benchmark/benchmark";

import { TIER_INFO, TIER_ORDER, type EvidenceTier } from "./tiers";

export { TIER_INFO, TIER_ORDER, type EvidenceTier };

export interface InvoiceReconciliation {
  billedUsd: number;
  ledgerActualUsd: number;
  deltaPct: number;
  tolerance: number;
  matched: boolean;
  periodLabel?: string;
}

export interface TaskEvidence {
  stepId: string;
  taskKey?: string;
  name: string;
  classification: TaskClassification;
  callCount?: number;
  currentUsd: number;
  modeledSavedUsd: number;
  modeledPct: number;
  /** The tier this task's claimed number belongs to. */
  tier: EvidenceTier;
  /** Claimed savings dollars by the tier that backs each part (sums to savedUsd). `tier` is the one holding the majority. */
  tierSplit: Partial<Record<EvidenceTier, number>>;
  /** Claimed savings, using the best rate evidence available. */
  savedUsd: number;
  savedPct: number;
  basis: string;
  replay?: Pick<TaskShadowSummary, "baselineUsd" | "verifiedSavedUsd" | "calls" | "cacheHits" | "downgrades" | "verifiedEqual" | "diverged" | "unverified" | "agreement" | "verdict" | "savedPct">;
  benchmark?: { recommendedTier: string | null; passRate: number; lowerBound: number; cases: number; evaluated: number; referenceKind: string };
  caveats: string[];
}

export interface EvidenceReport {
  generatedAt: string;
  title: string;
  traceId: string;
  sourceSummary: string;
  callCount?: number;
  totals: {
    baselineUsd: number;
    savedUsd: number;
    savedPct: number;
    /** What the modeled tier alone would have claimed — shown next to the evidence-adjusted number. */
    modeledSavedUsd: number;
    modeledSavedPct: number;
    byTier: Record<EvidenceTier, number>;
    /** Highest tier that still covers at least half of the claimed dollars. */
    headlineTier: EvidenceTier;
    /** Share of claimed dollars at "replayed" or stronger. */
    evidenceBackedShare: number;
  };
  tasks: TaskEvidence[];
  invoice?: InvoiceReconciliation;
  anonymization?: AnonymizationReport;
  assumptions: string[];
  caveats: string[];
}

export interface EvidenceInputs {
  title?: string;
  trace: WorkflowTrace;
  classifications?: StepClassification[];
  savings?: TraceSavingsReport;
  assumptions?: SavingsAssumptions;
  /** stepId -> taskKey, linking trace steps to shadow/ledger rows. */
  stepKeys?: Record<string, string>;
  shadow?: ShadowSummary;
  benchmarks?: TaskBenchmark[];
  ledger?: DecisionRecord[];
  invoice?: { billedUsd: number; tolerance?: number; periodLabel?: string };
  anonymization?: AnonymizationReport;
  sourceSummary?: string;
  callCount?: number;
  generatedAt?: string;
}

const MIN_MEASURED_CALLS = 20;

export function reconcileInvoice(ledger: DecisionRecord[], invoice: { billedUsd: number; tolerance?: number; periodLabel?: string }): InvoiceReconciliation {
  const tolerance = invoice.tolerance ?? 0.05;
  const ledgerActualUsd = ledger.reduce((s, r) => s + r.policyUsd, 0);
  const deltaPct = invoice.billedUsd > 0 ? (ledgerActualUsd - invoice.billedUsd) / invoice.billedUsd : 0;
  return { billedUsd: invoice.billedUsd, ledgerActualUsd, deltaPct, tolerance, matched: invoice.billedUsd > 0 && Math.abs(deltaPct) <= tolerance, periodLabel: invoice.periodLabel };
}

export function buildEvidenceReport(inp: EvidenceInputs): EvidenceReport {
  const classifications = inp.classifications ?? classifyTrace(inp.trace);
  const assumptions = inp.assumptions ?? DEFAULT_ASSUMPTIONS;
  const savings = inp.savings ?? computeTraceSavings(inp.trace, classifications, assumptions);
  const keyOf = (stepId: string) => inp.stepKeys?.[stepId];
  const shadowByKey = new Map((inp.shadow?.tasks ?? []).map((t) => [t.taskKey, t]));
  const benchByKey = new Map((inp.benchmarks ?? []).map((b) => [b.taskKey, b]));
  const ledgerSummary = inp.ledger && inp.ledger.length > 0 ? summarizeDecisions(inp.ledger) : undefined;
  const ledgerByKey = new Map((ledgerSummary?.tasks ?? []).map((t) => [t.taskKey, t]));
  const invoice = inp.ledger && inp.invoice ? reconcileInvoice(inp.ledger, inp.invoice) : undefined;

  const tasks: TaskEvidence[] = inp.trace.steps.map((step) => {
    const est = savings.steps.find((s) => s.stepId === step.id)!;
    const cls = classifications.find((c) => c.stepId === step.id)!;
    const key = keyOf(step.id);
    const replay = key ? shadowByKey.get(key) : undefined;
    const bench = key ? benchByKey.get(key) : undefined;
    const live = key ? ledgerByKey.get(key) : undefined;

    const modeledSaved = Math.max(0, est.currentUsd - est.recommendedUsd);
    const modeledPct = est.currentUsd > 0 ? modeledSaved / est.currentUsd : 0;
    const caveats: string[] = [];

    const benchPass = !!bench?.recommended;
    const benchmarkInfo = bench && {
      recommendedTier: bench.recommended?.tier ?? null,
      passRate: Math.max(...bench.results.map((r) => r.passRate), 0),
      lowerBound: Math.max(...bench.results.map((r) => r.passRateLowerBound), 0),
      cases: bench.cases,
      evaluated: Math.max(...bench.results.map((r) => r.evaluated), 0),
      referenceKind: bench.referenceKind,
    };
    if (bench?.referenceKind === "frontier-recorded") caveats.push("Benchmark labels are the frontier model's own recorded answers: this measures agreement with current behavior, not ground truth.");

    let tier: EvidenceTier = "modeled";
    let savedPct = modeledPct;
    let basis = "Classifier + price-table arithmetic.";

    if (replay) {
      if (replay.verdict === "unsafe") {
        savedPct = 0;
        basis = `Replay disagreed with recorded answers on ${replay.diverged} of ${replay.verifiedEqual + replay.diverged} checked calls — savings withheld.`;
        caveats.push("Do not enforce this task: cached/downgraded answers diverged from the recorded ones.");
      } else if (replay.cacheHits + replay.downgrades > 0) {
        savedPct = replay.savedPct;
        if (replay.verdict === "safe" || benchPass) {
          tier = "replayed";
          basis = `Policy replayed over ${replay.calls} recorded calls (${replay.cacheHits} cache hits, ${replay.downgrades} downgrades); ${replay.verifiedEqual} outputs verified identical.`;
        } else {
          basis = `Rate from replaying ${replay.calls} recorded calls, but only ${replay.verifiedEqual + replay.diverged} outputs could be checked — quality unproven.`;
          caveats.push("Quality of the cheaper route is unverified for most calls; run a benchmark before enforcing.");
        }
      } else {
        savedPct = 0;
        basis = `Replay left ${replay.calls} recorded calls on their current model (frontier-class, cold start, or tools) — no savings claimed.`;
      }
    } else if (benchPass && modeledPct > 0) {
      tier = "benchmarked";
      basis = `Modeled rate; a ${bench!.referenceKind} benchmark shows tier "${bench!.recommended!.tier}" passes (95% lower bound ${(bench!.recommended!.passRateLowerBound * 100).toFixed(0)}%).`;
    }

    if (live && live.calls >= MIN_MEASURED_CALLS && live.verdict !== "unsafe") {
      savedPct = live.savedPct;
      tier = invoice?.matched ? "verified" : "measured";
      basis = `${live.calls} live requests through the proxy: ${live.cacheHits} cache hits, ${live.downgrades} downgrades${invoice?.matched ? "; actual spend matches the invoice" : ""}.`;
    }
    const savedUsdTask = est.currentUsd * savedPct;
    const tierSplit: Partial<Record<EvidenceTier, number>> = {};
    if (tier === "measured" || tier === "verified") {
      tierSplit[tier] = savedUsdTask;
    } else if (replay && replay.verdict !== "unsafe" && savedPct > 0 && !(tier === "modeled" && !replay)) {
      // Only the part of the savings whose outputs were checked against a recorded answer earns "replayed"
      // (or all of it if a benchmark vouches for the cheaper tier). The rest is a real rate on real traffic,
      // but with unproven quality, so it stays "modeled".
      const verifiedFrac = benchPass ? 1 : replay.baselineUsd > 0 ? Math.min(1, replay.verifiedSavedUsd / replay.baselineUsd / savedPct) : 0;
      const strong = savedUsdTask * verifiedFrac;
      if (strong > 0) tierSplit.replayed = strong;
      if (savedUsdTask - strong > 0) tierSplit.modeled = savedUsdTask - strong;
      tier = strong >= savedUsdTask / 2 ? "replayed" : "modeled";
    } else if (savedUsdTask > 0) {
      tierSplit[tier] = savedUsdTask;
    }
    if (tier === "modeled" && (tierSplit.replayed ?? 0) > 0 && replay && replay.verdict !== "safe") caveats.push("Only part of this task's savings could be checked against recorded answers; the rest is unproven.");

    if (est.tokenSource === "estimated") caveats.push("Token counts are estimated (~4 chars/token), not reported by the provider.");

    return {
      stepId: step.id,
      taskKey: key,
      name: step.name,
      classification: cls.classification,
      callCount: step.observedStats?.callCount,
      currentUsd: est.currentUsd,
      modeledSavedUsd: modeledSaved,
      modeledPct,
      tier,
      tierSplit,
      savedUsd: savedUsdTask,
      savedPct,
      basis,
      replay: replay && { baselineUsd: replay.baselineUsd, verifiedSavedUsd: replay.verifiedSavedUsd, calls: replay.calls, cacheHits: replay.cacheHits, downgrades: replay.downgrades, verifiedEqual: replay.verifiedEqual, diverged: replay.diverged, unverified: replay.unverified, agreement: replay.agreement, verdict: replay.verdict, savedPct: replay.savedPct },
      benchmark: benchmarkInfo,
      caveats,
    };
  });

  const baselineUsd = tasks.reduce((s, t) => s + t.currentUsd, 0);
  const savedUsd = tasks.reduce((s, t) => s + t.savedUsd, 0);
  const modeledSavedUsd = tasks.reduce((s, t) => s + t.modeledSavedUsd, 0);
  const byTier = Object.fromEntries(TIER_ORDER.map((t) => [t, 0])) as Record<EvidenceTier, number>;
  for (const t of tasks) for (const [k, v] of Object.entries(t.tierSplit)) byTier[k as EvidenceTier] += v ?? 0;

  let headlineTier: EvidenceTier = "modeled";
  let acc = 0;
  for (const t of [...TIER_ORDER].reverse()) {
    acc += byTier[t];
    if (savedUsd > 0 && acc >= savedUsd / 2) {
      headlineTier = t;
      break;
    }
  }
  const strong = byTier.replayed + byTier.measured + byTier.verified;

  const pricing = DEFAULT_PRICING;
  const reportAssumptions = [
    `Prices are the tier table in the report's pricing config (frontier $${pricing.frontier.inputPerMillion}/$${pricing.frontier.outputPerMillion}, near-frontier $${pricing["near-frontier"].inputPerMillion}/$${pricing["near-frontier"].outputPerMillion}, non-frontier $${pricing["non-frontier"].inputPerMillion}/$${pricing["non-frontier"].outputPerMillion} per million input/output tokens). They are illustrative — substitute your contract prices before quoting dollars.`,
    `Prompt-cache reads are priced at ${(CACHED_INPUT_DISCOUNT * 100).toFixed(0)}% of normal input price.`,
    "A downgraded call is assumed to use the same token counts it used on the original model.",
    `Modeled cache savings assume a ${(assumptions.cacheHitRate * 100).toFixed(0)}% hit rate once warm; replayed/measured tiers use the observed rate instead.`,
    "Models are mapped to price tiers by name pattern; unrecognized models are treated as frontier-priced.",
  ];

  const reportCaveats: string[] = [];
  if (!inp.shadow) reportCaveats.push("No recorded traffic was replayed: every figure in this report is modeled. Run shadow mode on real traces to upgrade it.");
  if (invoice && !invoice.matched) reportCaveats.push(`Ledger spend differs from the invoice by ${(invoice.deltaPct * 100).toFixed(1)}% (tolerance ${(invoice.tolerance * 100).toFixed(0)}%) — measured savings are not invoice-verified.`);
  if (byTier.modeled > savedUsd * 0.5 && savedUsd > 0) reportCaveats.push("More than half of the claimed savings are modeled only.");

  return {
    generatedAt: inp.generatedAt ?? new Date().toISOString(),
    title: inp.title ?? inp.trace.name,
    traceId: inp.trace.id,
    sourceSummary: inp.sourceSummary ?? inp.trace.description ?? "",
    callCount: inp.callCount,
    totals: {
      baselineUsd,
      savedUsd,
      savedPct: baselineUsd > 0 ? savedUsd / baselineUsd : 0,
      modeledSavedUsd,
      modeledSavedPct: baselineUsd > 0 ? modeledSavedUsd / baselineUsd : 0,
      byTier,
      headlineTier,
      evidenceBackedShare: savedUsd > 0 ? strong / savedUsd : 0,
    },
    tasks: tasks.sort((a, b) => b.currentUsd - a.currentUsd),
    invoice,
    anonymization: inp.anonymization,
    assumptions: reportAssumptions,
    caveats: reportCaveats,
  };
}

/** One-call pipeline: recorded calls -> trace -> classify -> modeled savings -> shadow replay -> offline benchmark -> tiered report. */
export async function buildEvidenceReportFromCalls(
  calls: CallRecord[],
  opts: { title?: string; anonymization?: AnonymizationReport; ledger?: DecisionRecord[]; invoice?: EvidenceInputs["invoice"]; generatedAt?: string; benchmarkThreshold?: number } = {},
): Promise<EvidenceReport & { shadow: ReturnType<typeof replayCalls> }> {
  const trace = callsToWorkflowTrace(calls, { name: opts.title });
  const stepKeys = Object.fromEntries(groupCallsByTask(calls).map((g) => [g.stepId, g.key]));
  const shadow = replayCalls(calls);

  // Offline benchmark: only tiers that actually answered some of the same inputs can be evaluated.
  const cases = casesFromCalls(calls);
  const benchmarks: TaskBenchmark[] = [];
  for (const [, list] of cases) {
    const cands = (["non-frontier", "near-frontier"] as const).map((t) => recordedCandidate(calls, t));
    const bench = await benchmarkTask(list, cands, { threshold: opts.benchmarkThreshold ?? 0.9 });
    if (bench.results.some((r) => r.evaluated >= 5)) benchmarks.push(bench);
  }

  const report = buildEvidenceReport({
    ...opts,
    trace,
    stepKeys,
    shadow: shadow.summary,
    benchmarks,
    callCount: calls.length,
    sourceSummary: `${calls.length} recorded calls from ${[...new Set(calls.map((c) => c.source))].join(", ")} across ${trace.steps.length} task(s).`,
  });
  return { ...report, shadow };
}
