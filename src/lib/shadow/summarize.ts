import type { TaskClassification } from "../workflow/types";
import type { DecisionRecord } from "../gateway/types";

export type TaskVerdict =
  /** Acted on, and replayed outputs matched often enough, on enough verified calls. */
  | "safe"
  /** Acted on, verified calls disagreed too often. Do not enforce. */
  | "unsafe"
  /** Acted on, but too few calls could be checked against a recorded answer. Needs a benchmark or more shadow time. */
  | "insufficient-evidence"
  /** The policy left this task alone (frontier / cold start). Nothing to approve. */
  | "keep";

export interface ShadowThresholds {
  /** Minimum agreement among verified calls to call a task safe. Default 0.97. */
  minAgreement: number;
  /** Minimum number of verified calls before a verdict can be "safe". Default 5. */
  minVerified: number;
  /** Minimum share of acted calls that could be checked against a recorded answer. Default 0.5: a task can't be "safe" on the strength of a few cache hits while most of its downgrades went unchecked. */
  minVerifiedShare: number;
}

export const DEFAULT_SHADOW_THRESHOLDS: ShadowThresholds = { minAgreement: 0.97, minVerified: 5, minVerifiedShare: 0.5 };

export interface TaskShadowSummary {
  task: string;
  taskKey: string;
  classification: TaskClassification;
  calls: number;
  cacheHits: number;
  downgrades: number;
  /** Calls the policy left on the requested model (cold start, frontier, tools, unapproved). */
  passthrough: number;
  baselineUsd: number;
  policyUsd: number;
  savedUsd: number;
  savedPct: number;
  verifiedEqual: number;
  diverged: number;
  unverified: number;
  /** Of acted calls, share whose replay output could be checked against a recorded answer. */
  verifiedShare: number;
  /** verifiedEqual / (verifiedEqual + diverged); 1 when nothing was verified (see verdict). */
  agreement: number;
  /** Savings from calls whose output matched the recorded answer exactly — the part with quality evidence. */
  verifiedSavedUsd: number;
  verdict: TaskVerdict;
}

export interface ShadowSummary {
  calls: number;
  baselineUsd: number;
  policyUsd: number;
  savedUsd: number;
  savedPct: number;
  verifiedSavedUsd: number;
  tasks: TaskShadowSummary[];
}

/** Rolls per-call decision records (from replay or the live ledger) up to per-task evidence and verdicts. */
export function summarizeDecisions(records: DecisionRecord[], thresholds: ShadowThresholds = DEFAULT_SHADOW_THRESHOLDS): ShadowSummary {
  const byTask = new Map<string, DecisionRecord[]>();
  for (const r of records) byTask.set(r.taskKey, [...(byTask.get(r.taskKey) ?? []), r]);

  const tasks: TaskShadowSummary[] = [...byTask.values()].map((rs) => {
    let cacheHits = 0, downgrades = 0, passthrough = 0, baselineUsd = 0, policyUsd = 0, verifiedEqual = 0, diverged = 0, unverified = 0, verifiedSavedUsd = 0;
    for (const r of rs) {
      baselineUsd += r.baselineUsd;
      policyUsd += r.policyUsd;
      if (r.action === "cache-hit") cacheHits++;
      else if (r.action === "downgrade" || r.action === "code") downgrades++;
      else passthrough++;
      if (r.verification === "verified-equal") {
        verifiedEqual++;
        verifiedSavedUsd += r.baselineUsd - r.policyUsd;
      } else if (r.verification === "diverged") diverged++;
      else if (r.verification === "unverified") unverified++;
    }
    const acted = cacheHits + downgrades;
    const verified = verifiedEqual + diverged;
    const agreement = verified > 0 ? verifiedEqual / verified : 1;
    let verdict: TaskVerdict;
    if (acted === 0) verdict = "keep";
    else if (verified > 0 && agreement < thresholds.minAgreement) verdict = "unsafe";
    else if (verified >= thresholds.minVerified && verified / acted >= thresholds.minVerifiedShare) verdict = "safe";
    else verdict = "insufficient-evidence";

    const classCounts = new Map<TaskClassification, number>();
    for (const r of rs) classCounts.set(r.classification, (classCounts.get(r.classification) ?? 0) + 1);
    const classification = [...classCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];

    return {
      task: rs[0].task,
      taskKey: rs[0].taskKey,
      classification,
      calls: rs.length,
      cacheHits,
      downgrades,
      passthrough,
      baselineUsd,
      policyUsd,
      savedUsd: baselineUsd - policyUsd,
      savedPct: baselineUsd > 0 ? (baselineUsd - policyUsd) / baselineUsd : 0,
      verifiedEqual,
      diverged,
      unverified,
      verifiedShare: acted > 0 ? verified / acted : 0,
      agreement,
      verifiedSavedUsd,
      verdict,
    };
  });

  const baselineUsd = tasks.reduce((s, t) => s + t.baselineUsd, 0);
  const policyUsd = tasks.reduce((s, t) => s + t.policyUsd, 0);
  return {
    calls: records.length,
    baselineUsd,
    policyUsd,
    savedUsd: baselineUsd - policyUsd,
    savedPct: baselineUsd > 0 ? (baselineUsd - policyUsd) / baselineUsd : 0,
    verifiedSavedUsd: tasks.reduce((s, t) => s + t.verifiedSavedUsd, 0),
    tasks: tasks.sort((a, b) => b.baselineUsd - a.baselineUsd),
  };
}

/** Task keys a shadow run approved for enforcement (verdict "safe"). Feed to `GatewayEngine.restrictTo`. */
export function approvedTaskKeys(summary: ShadowSummary): string[] {
  return summary.tasks.filter((t) => t.verdict === "safe").map((t) => t.taskKey);
}
