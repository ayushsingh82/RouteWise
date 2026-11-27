import { resolveTier } from "../workflow/pricing";
import { GatewayEngine, requestTaskKey } from "../gateway/engine";
import { DEFAULT_GATEWAY_POLICY, type GatewayPolicy } from "../gateway/policy";
import type { DecisionRecord, GatewayRequest, Verification } from "../gateway/types";
import type { CallRecord } from "../ingest/types";
import { callCostAtTierUsd, normalizeInput, taskLabel } from "../ingest/to-trace-shared";
import { DEFAULT_SHADOW_THRESHOLDS, summarizeDecisions, type ShadowSummary, type ShadowThresholds } from "./summarize";

export function callToRequest(c: CallRecord): GatewayRequest {
  return { provider: c.provider, model: c.model, task: c.task, system: c.system, input: c.input, temperature: c.temperature, usesTools: (c.tools?.length ?? 0) > 0 };
}

export interface ReplayOptions {
  policy?: GatewayPolicy;
  thresholds?: ShadowThresholds;
  /** Reuse an engine (e.g. one pre-warmed) instead of a fresh one. */
  engine?: GatewayEngine;
}

export interface ReplayReport {
  records: DecisionRecord[];
  summary: ShadowSummary;
  policy: GatewayPolicy;
  /** Calls with an input we could not compare (empty prompt, e.g. bare OpenAI completions). */
  uncomparableCalls: number;
}

/**
 * Shadow mode, offline: replays the gateway's routing policy over recorded
 * calls in chronological order — nothing is called, nothing is changed. Each
 * call is decided by the same GatewayEngine the live proxy uses, learning only
 * from earlier calls (no lookahead), then scored:
 *   - cache hit  -> verified-equal if the cached answer matches what the model
 *                   actually said that time, diverged if not.
 *   - downgrade  -> verified against any recorded answer the *cheaper* tier
 *                   gave to the same input (e.g. from an A/B or eval run);
 *                   unverified otherwise — savings counted, quality unproven.
 * All dollar figures use the tier price table on recorded token counts.
 */
export function replayCalls(calls: CallRecord[], opts: ReplayOptions = {}): ReplayReport {
  const policy = opts.policy ?? DEFAULT_GATEWAY_POLICY;
  const engine = opts.engine ?? new GatewayEngine(policy);

  const ordered = calls.map((c, i) => ({ c, i })).sort((a, b) => (a.c.timestamp ?? 0) - (b.c.timestamp ?? 0) || a.i - b.i).map((x) => x.c);

  // Index of what each tier answered for each (task, input): the evidence used to verify downgrades.
  const altKey = (taskKey: string, c: CallRecord, tier: string) => `${taskKey}\u0000${c.provider}\u0000${normalizeInput(c.input)}\u0000${tier}`;
  const alternatives = new Map<string, Set<string>>();
  for (const c of ordered) {
    const k = altKey(requestTaskKey(callToRequest(c)), c, resolveTier(c.model));
    alternatives.set(k, (alternatives.get(k) ?? new Set()).add(normalizeInput(c.output)));
  }

  const records: DecisionRecord[] = [];
  let uncomparable = 0;
  for (const c of ordered) {
    const req = callToRequest(c);
    const d = engine.decide(req);
    const requestedTier = resolveTier(c.model);
    const baselineUsd = callCostAtTierUsd(c, requestedTier, policy.pricing);
    if (c.input === "") uncomparable++;

    let policyUsd = baselineUsd;
    let verification: Verification = "n/a";
    if (d.action === "cache-hit") {
      policyUsd = 0;
      verification = c.output === "" ? "unverified" : normalizeInput(d.cached!.output) === normalizeInput(c.output) ? "verified-equal" : "diverged";
    } else if (d.action === "downgrade") {
      policyUsd = callCostAtTierUsd(c, d.targetTier, policy.pricing);
      const answers = alternatives.get(altKey(d.taskKey, c, d.targetTier));
      verification = !answers ? "unverified" : answers.has(normalizeInput(c.output)) ? "verified-equal" : "diverged";
    }

    records.push({
      id: c.id,
      ts: c.timestamp,
      task: taskLabel(c),
      taskKey: d.taskKey,
      action: d.action,
      classification: d.classification,
      confidence: d.confidence,
      requestedModel: c.model,
      usedModel: d.targetModel,
      baselineUsd,
      policyUsd,
      inputTokens: c.inputTokens,
      outputTokens: c.outputTokens,
      verification,
      enforced: false,
    });
    engine.record(req, { output: c.output, inputTokens: c.inputTokens, outputTokens: c.outputTokens, model: c.model, cacheable: (c.tools?.length ?? 0) === 0 });
  }

  return { records, summary: summarizeDecisions(records, opts.thresholds ?? DEFAULT_SHADOW_THRESHOLDS), policy, uncomparableCalls: uncomparable };
}
