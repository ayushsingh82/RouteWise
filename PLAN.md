# PLAN.md — tokenmax

Problem statement: [`README.md`](./README.md). This plan turns the thesis ("spend intelligence sparingly — code where deterministic, small models where sufficient, cache where repeatable, frontier only where judgment is required") into a buildable system, broken into phases and points.

## Phase 0 — Foundations (current)

- [x] Repo scaffolded: Next.js (App Router, TS, Tailwind, ESLint).
- [x] README.md with problem statement + core thesis.
- [x] COMPETITORS.md — landscape of who else is building model routing / token-cost optimization. Main competitor identified: [Mentlio](./COMPETITORS.md#0-mentlio--main-competitor) (archived docs/benchmarks in [`research/mentlio/`](./research/mentlio/)).
- [x] Decide product wedge (see "Product wedge options" below) before writing app code.

## Phase 1 — Task decomposition engine ✅ core built

The unit of automation is the task, not the workflow. Before anything can be routed, a workflow needs to be broken into discrete steps.

1. **Workflow ingestion** ✅ — [`src/lib/workflow/ingest.ts`](./src/lib/workflow/ingest.ts) (`ingestWorkflowTrace`) validates/normalizes a raw workflow definition (config, trace export, or hand-authored) into a `WorkflowTrace`.
2. **Step extraction** ✅ — [`src/lib/workflow/ingest.ts`](./src/lib/workflow/ingest.ts) (`extractStepsInOrder`) topologically sorts steps by `dependsOn`, detects cycles/dangling deps. Step shape (inputs/outputs/implementation/dependencies) is defined in [`src/lib/workflow/types.ts`](./src/lib/workflow/types.ts).
3. **Task classification** ✅ — [`src/lib/workflow/classify.ts`](./src/lib/workflow/classify.ts) (`classifyStep`/`classifyTrace`), rules-based for now (see non-goals: prompt-based classification for ambiguous steps is still open):
   - `deterministic` — output is a pure function of input (field match, data move, rule application) → replace with code.
   - `cacheable` — same input has recurred before with a known-correct output → serve from cache.
   - `simple-judgment` — requires interpretation but within a narrow, well-bounded decision space → route to a small/cheap model.
   - `complex-judgment` — ambiguous, high-context, or high-stakes → route to a frontier model or a human.
4. **Classification signals** ✅ (heuristic version) — implementation kind, output cardinality (boolean/enum-like → deterministic candidate), category/mapping keywords → cacheable, high-stakes/risk keywords → complex-judgment, unmatched steps fall back to `complex-judgment` (escalate, don't under-classify). Real historical-output-variance signals need production trace data — open item.

Validated end-to-end against the AP invoice fixture: correctly classifies 2 of the AP workflow's 4 model-call steps (`gl_code_line_item`, `check_approval_threshold`) as downgrade candidates.

## Phase 2 — Routing layer ✅ core built

1. **Model/resource registry** ✅ — [`src/lib/workflow/pricing.ts`](./src/lib/workflow/pricing.ts): 3-tier pricing config (frontier / near-frontier / non-frontier), illustrative defaults, override with real pricing before trusting absolute $ figures.
2. **Router** ✅ — [`src/lib/workflow/router.ts`](./src/lib/workflow/router.ts) (`routeStep`/`routeTrace`) maps each classified step to a resource (code / cache / model-tier / human). `summarizeRouting()` reports the **90/9/1-style split** (share of model calls landing on each tier).
3. **Escalation policy** ✅ — built into the router: below `policy.minConfidence`, a step's default resource is overridden by a safety-net tier (`policy.fallbackTier`) instead of trusted outright. Verified: tightening `minConfidence` to 0.8 correctly escalates `extract_line_items` and `gl_code_line_item`, which sit at 0.7/0.75 confidence.
4. **Per-task benchmarking** ⬜ open — needs a labeled sample of real task inputs/outputs to benchmark candidate models against; can't be built against synthetic fixtures alone.

## Phase 3 — Caching layer ✅ core built

1. **Cache key design** ✅ — [`src/lib/workflow/cache.ts`](./src/lib/workflow/cache.ts) `defaultCacheKey` (trimmed/lowercased string or JSON.stringify); callers can pass a task-specific `keyFn` (e.g. fuzzy vendor-name matching) to `WorkflowCache`.
2. **Cache store** ✅ — `WorkflowCache` class: key → value with `provenance` (`"model"` vs `"human-corrected"`), `hitCount`.
3. **Invalidation policy** ✅ (mechanism, not policy content) — `ttlMs` on `set()`, plus `invalidate()`/`clear()` for manual invalidation (e.g. chart-of-accounts revision). Actual TTL/review-trigger values per task type are still a product decision, not a code one.
4. **Cache-hit accounting** ✅ — `cacheSavingsUsd(stats, avoidedCostPerCallUsd)` turns `WorkflowCache.stats()` into a dollar figure, feeding Phase 5.

## Phase 4 — Context/harness minimization ✅ core built

1. **Context scoping per task** ✅ — [`src/lib/workflow/context.ts`](./src/lib/workflow/context.ts) `buildScopedContext()`: a step's declared `inputs` *are* its minimal context schema.
2. **Context templates per task type** ✅ (via the schema) — `WorkflowStep.inputs` is the template; no separate templating layer needed since ingestion already forces steps to declare only what they use.
3. **Measure context bloat** ✅ — `measureContextBloat()`/`measureTraceContextBloat()` compare scoped-context token cost against a naive full-workflow-history baseline (`buildFullHistoryContext`). On the AP fixture, bloat ratios range **1.6x–22.75x**, growing with position in the workflow — exactly the "don't feed the entire workflow history into every call" waste the source article calls out.

## Phase 5 — Measurement / ROI ✅ non-UI core built (dashboard itself is UI — deferred per non-goals)

1. **Track ROI on intelligence, not raw spend** ✅ — [`src/lib/workflow/savings.ts`](./src/lib/workflow/savings.ts) `computeTraceSavings()` prices every step three ways: naive-frontier baseline, actual current spend, and recommended routed spend.
2. **Track the 90/9/1 split in practice** ✅ — `summarizeRouting()` in `router.ts`.
3. **Track savings vs. the "everything on frontier" baseline** ✅ — `computeTraceSavings().totals.savingsVsNaiveFrontierPct`. On the AP fixture this comes out to **51.8%**, not 90% — correctly, since `flag_anomaly` legitimately stays frontier-tier and dominates the total. Confirms the non-goal below: the number is computed, not asserted.
4. **Track cache hit rate and deterministic-code coverage** ✅ — `WorkflowCache.stats().hitRate` + `assessWorkflowHealth().modelStepShare` (below).
5. **Flag workflows still running workflow-level** ✅ — [`src/lib/workflow/health.ts`](./src/lib/workflow/health.ts) `assessWorkflowHealth()`: flags a trace as a decomposition candidate when >50% of steps are still model calls, or when any step is classified deterministic/cacheable but still implemented as a model call. Correctly flags the AP fixture (44% model-step share, 2 downgradeable steps).

**Still open in Phase 5:** the actual dashboard UI (explicit non-goal until the wedge validates further), and `formatSavingsReport()` in `savings.ts` is currently the only "report" surface (plain text) — matches Wedge A's audit-report deliverable but hasn't been tried against a second, independently-authored trace yet.

## Product wedge options (decided)

- **A. Workflow analyzer / audit tool** — ingest an existing agent's trace logs, classify each step, and output a report: "X% of your calls could be code, Y% could be a cheap model, Z% must stay frontier," with estimated $ savings.
- **B. Routing proxy/gateway** — a drop-in LLM API layer that sits in front of existing agent code, classifies+caches+routes calls automatically (similar shape to an LLM gateway, but decomposition-aware rather than just picking a model per call).
- **C. Framework/SDK** — a library for building agents where task classification and routing are first-class primitives from day one, instead of retrofitted.

**Decision: start with A (analyzer/audit)** — smallest surface area, produces an immediately shareable artifact (the savings report), validates classification logic against real traces, upsell path into B/C later.

**Scope decision, informed by [Mentlio](./COMPETITORS.md#0-mentlio--main-competitor):** target **general multi-step business workflows** (AP/AR processing, invoice GL-coding, email/ticket triage, approval chains — the exact examples in the source tweet), **not AI-coding-agent sessions**. Mentlio already owns the coding-agent niche cleanly — desktop agent hooked into Claude Code/Codex/Cursor, GitHub/Jira/Linear/Slack integrations, published SWE-Bench Pro/Terminal-Bench benchmarks. Competing there means beating an already-benchmarked incumbent on its home turf. The business-workflow decomposition layer (Phase 1: classify a workflow's *steps*, not a coding session's *turns*, into `deterministic / cacheable / simple-judgment / complex-judgment`) is the gap nobody in the competitor scan has filled. This also matches Varick Agents' own framing (invoices, AP/AR, GL-coding) more directly than a coding-tool wedge would.

**Adopt from Mentlio's execution, regardless of scope difference:**
- Local-first / privacy-preserving measurement architecture — compute sensitive analysis on-device, upload only derived telemetry (scores, classifications, token counts), never raw prompts/documents. Design this in from the start, not as a retrofit.
- **Shadow mode** as the rollout mechanism — replay a classification/routing policy against recorded workflow traces before ever letting it act live. This is Wedge A's actual delivery mechanism, not just an MVP shortcut.
- **Evidence-tiered savings claims** — every savings number ships with its measurement method and honest caveats (benchmark-modeled vs. invoice-verified), the way Mentlio's `savings-methodology.md` does. No "90%" headline without a reproducible artifact behind it.

## Explicit non-goals (for now)

- No UI work until the wedge (A/B/C) is chosen and the classification logic is validated against sample data.
- No fine-tuning or training of custom small models — routing across existing hosted models only, initially.
- No claim of exact "90%" savings without being able to compute it from real trace data — the number is a target/label to validate, not a guarantee to bake in.

## Immediate next steps — completed batch

1. ~~Write `COMPETITORS.md`.~~ Done.
2. ~~Pick first target workflow.~~ Done — AP invoice processing (tweet's own worked example: stapler → "office supplies").
3. ~~Build Phase 1 workflow ingestion + step extraction against the AP fixture.~~ Done — `types.ts`, `ingest.ts`, `fixtures/ap-invoice-processing.ts`.
4. ~~Build a minimal classifier.~~ Done (rules-based half) — `classify.ts`. Prompt-based fallback for steps the rules can't confidently classify is still open (see below).
5. ~~Build the savings-estimate calculator.~~ Done — `savings.ts`, plus the rest of Phases 2–5's non-UI core: `pricing.ts`, `router.ts`, `cache.ts`, `context.ts`, `health.ts`.

All of the above is verified end-to-end via `tsx` smoke tests against the AP invoice fixture (not yet a real test suite — see below) and type-checks clean (`npx tsc --noEmit`).

## Next up

1. **Add a real test suite.** Everything so far has been verified with ad hoc `tsx -e` smoke tests, not committed tests. Add Vitest (or similar) and turn those smoke tests into real unit tests before building more on top — this is the biggest correctness gap right now.
2. **Second target workflow.** Validate the classifier/router/savings pipeline against a workflow that isn't AP invoicing (e.g. support-ticket triage, or the email-triage example from the source article) to check the heuristics in `classify.ts` generalize instead of being accidentally tuned to one fixture.
3. **Prompt-based classifier fallback.** `classify.ts` currently defaults unmatched steps to `complex-judgment` (safe, but conservative). Add an LLM-based classification pass for steps the rules don't confidently match, per the original "rules + prompt-based" plan.
4. **Per-task benchmarking (Phase 2.4).** Needs real labeled input/output samples per task — can't be done against synthetic fixtures.
5. **Wire Product Wedge A end-to-end**: a CLI or API endpoint that takes a raw trace file, runs ingest → classify → route → savings, and emits `formatSavingsReport()`'s output — the actual shareable audit artifact, still just a library today.
