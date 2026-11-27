import { classifyStep, type StepClassification } from "../workflow/classify";
import { routeStep } from "../workflow/router";
import { resolveTier, type ResourceTier } from "../workflow/pricing";
import { WorkflowCache } from "../workflow/cache";
import { TaskAggregator } from "../ingest/aggregate";
import { normalizeInput, taskKey } from "../ingest/to-trace-shared";
import type { CallRecord } from "../ingest/types";
import { DEFAULT_GATEWAY_POLICY, type GatewayPolicy } from "./policy";
import type { CachedResponse, CallOutcome, GatewayDecision, GatewayRequest } from "./types";

const TIER_RANK: Record<ResourceTier, number> = { "non-frontier": 0, "near-frontier": 1, frontier: 2 };

function asCallRecord(req: GatewayRequest, out: CallOutcome): CallRecord {
  return {
    id: "live",
    sessionId: "live",
    timestamp: null,
    provider: req.provider,
    model: out.model,
    task: req.task,
    system: req.system,
    input: req.input,
    output: out.output,
    inputTokens: out.inputTokens,
    outputTokens: out.outputTokens,
    source: "openai",
  };
}

/** Identity of the task a request belongs to (same derivation as ingestion, so live and recorded traffic line up). */
export function requestTaskKey(req: GatewayRequest): string {
  return taskKey({ task: req.task, system: req.system });
}

interface TaskState {
  aggregator: TaskAggregator;
  classification: StepClassification;
  classifiedAtCalls: number;
}

/**
 * The gateway's brain: given a request, decide passthrough / cache-hit /
 * downgrade, then learn from the outcome. Pure and synchronous — no network —
 * which is what lets the proxy (live) and shadow mode (replaying recorded
 * traces) share it: the same code makes the decision in both, so a shadow
 * report describes what the proxy would really have done.
 *
 * Learning is online: a task is classified from the calls seen *so far*
 * (observed repeat-input / output-consistency stats plus the prompt keywords),
 * never from future traffic, and is reclassified as evidence accumulates.
 */
export class GatewayEngine {
  private tasks = new Map<string, TaskState>();
  private cache: WorkflowCache<CachedResponse>;
  /** Overrides: force a classification for a task (e.g. from a reviewed shadow report). Keyed by taskKey. */
  private pinned = new Map<string, StepClassification["classification"]>();
  /** Tasks the operator allows to be acted upon. null = all (default). */
  private allowed: Set<string> | null = null;

  constructor(public readonly policy: GatewayPolicy = DEFAULT_GATEWAY_POLICY) {
    this.cache = new WorkflowCache<CachedResponse>((k) => String(k), { maxEntries: policy.cacheMaxEntries });
  }

  /** Restricts acting (cache/downgrade) to these task keys; everything else passes through. Used to enforce only shadow-approved tasks. */
  restrictTo(taskKeys: Iterable<string> | null): void {
    this.allowed = taskKeys === null ? null : new Set(taskKeys);
  }

  classificationFor(key: string): StepClassification | undefined {
    return this.tasks.get(key)?.classification;
  }

  observedCalls(key: string): number {
    return this.tasks.get(key)?.aggregator.calls ?? 0;
  }

  private cacheKey(key: string, req: GatewayRequest): string {
    return `${key}\u0000${req.provider}\u0000${normalizeInput(req.input)}`;
  }

  decide(req: GatewayRequest): GatewayDecision {
    const key = requestTaskKey(req);
    const requestedTier = resolveTier(req.model);
    const state = this.tasks.get(key);
    const base = {
      taskKey: key,
      requestedModel: req.model,
      requestedTier,
      targetModel: req.model,
      targetTier: requestedTier,
    };

    const pass = (reason: string, classification = state?.classification): GatewayDecision => ({
      ...base,
      action: "passthrough",
      classification: classification?.classification ?? "complex-judgment",
      confidence: classification?.confidence ?? 0,
      reason,
    });

    if (!state) return pass("Cold start: task not seen yet — observing before acting.");
    if (state.aggregator.calls < this.policy.minObservations) {
      return pass(`Cold start: ${state.aggregator.calls}/${this.policy.minObservations} calls observed.`);
    }
    if (this.allowed && !this.allowed.has(key)) return pass("Task not approved for enforcement (no passing shadow verdict).");

    const classification = this.pinned.get(key)
      ? { ...state.classification, classification: this.pinned.get(key)!, confidence: 1 }
      : state.classification;
    const step = state.aggregator.toStep("task");
    const resource = routeStep(step, classification, this.policy.routing).resource;

    if (req.usesTools && !this.policy.allowDowngradeWithTools) {
      return pass("Request defines tools/structured output — passing through unchanged.", classification);
    }

    const out = { ...base, classification: classification.classification, confidence: classification.confidence };

    if (resource.kind === "cache") {
      const temp = req.temperature ?? 1;
      if (temp <= this.policy.cacheTemperatureMax) {
        const hit = this.cache.get(this.cacheKey(key, req));
        if (hit.hit && hit.entry) {
          return { ...out, action: "cache-hit", targetModel: hit.entry.value.model, reason: "Cacheable task, identical input seen before — serving the stored response.", cached: hit.entry.value };
        }
      }
      return this.downgrade(out, req, "non-frontier", "Cacheable task but no cached response (miss) — routing the miss to a non-frontier model.");
    }
    if (resource.kind === "code") {
      // No code handler can be executed by a generic proxy, so a deterministic task is treated as a cheap-model task here.
      return this.downgrade(out, req, "non-frontier", "Deterministic task — no code handler registered, so routed to a non-frontier model.");
    }
    if (resource.kind === "model" && resource.tier) {
      return this.downgrade(out, req, resource.tier, `Classified ${classification.classification} — routing to ${resource.tier}.`);
    }
    return pass("Routed to a human/frontier resource — passing through unchanged.", classification);
  }

  private downgrade(out: Omit<GatewayDecision, "action" | "reason" | "cached">, req: GatewayRequest, tier: ResourceTier, reason: string): GatewayDecision {
    if (TIER_RANK[tier] >= TIER_RANK[out.requestedTier]) {
      return { ...out, action: "passthrough", reason: `Requested model is already ${out.requestedTier}; nothing cheaper to route to.` };
    }
    const providerModels = req.provider === "other" ? undefined : this.policy.tierModels[req.provider];
    if (!providerModels) return { ...out, action: "passthrough", reason: "Unknown provider — no tier model mapping, passing through." };
    return { ...out, action: "downgrade", targetModel: providerModels[tier], targetTier: tier, reason };
  }

  /** Teach the engine what happened. Call for every request, whatever the decision was (the baseline output is what counts). */
  record(req: GatewayRequest, outcome: CallOutcome): void {
    const key = requestTaskKey(req);
    let state = this.tasks.get(key);
    if (!state) {
      state = { aggregator: new TaskAggregator(this.policy.pricing), classification: { stepId: "task", classification: "complex-judgment", confidence: 0.3, rationale: "Not enough observations yet.", signals: ["fallback:cold-start"] }, classifiedAtCalls: 0 };
      this.tasks.set(key, state);
    }
    state.aggregator.add(asCallRecord(req, outcome));

    // Reclassify on a doubling schedule so steady-state cost stays negligible.
    const n = state.aggregator.calls;
    if (n >= this.policy.minObservations && (state.classifiedAtCalls === 0 || n >= state.classifiedAtCalls * 2 || n === this.policy.minObservations)) {
      state.classification = classifyStep(state.aggregator.toStep("task"));
      state.classifiedAtCalls = n;
    }

    if (outcome.cacheable && (req.temperature ?? 1) <= this.policy.cacheTemperatureMax && !req.usesTools) {
      this.cache.set(this.cacheKey(key, req), { output: outcome.output, inputTokens: outcome.inputTokens, outputTokens: outcome.outputTokens, model: outcome.model }, { ttlMs: this.policy.cacheTtlMs });
    }
  }

  stats() {
    return { tasks: this.tasks.size, cache: this.cache.stats() };
  }
}
