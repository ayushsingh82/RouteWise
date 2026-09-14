# PLAN.md — RouteWise

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

**Dashboard UI** ✅ — built on explicit request, ahead of the original "no UI until the wedge validates further" non-goal: [`src/app/page.tsx`](./src/app/page.tsx) + [`src/app/dashboard.tsx`](./src/app/dashboard.tsx), backed by [`src/app/api/analyze/route.ts`](./src/app/api/analyze/route.ts) (the same ingest → classify → route → savings → health pipeline as the CLI, over HTTP). Fixture switcher, a Claude-fallback toggle, summary stat cards, a 90/9/1-style routing bar, a health banner, and a step-by-step table. Verified end-to-end via `npm run dev` + `curl` against the homepage and `/api/analyze` for all three fixtures (no headless-browser tool was available in this environment, so this was checked via server-rendered HTML + API responses, not a visual screenshot). Only serves the built-in fixtures for now — uploading a custom trace still goes through the CLI.

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
4. ~~Build a minimal classifier.~~ Done — `classify.ts` (rules-based) plus `classify-model.ts` (prompt-based fallback for steps the rules can't confidently classify; see "Next up — completed batch 2" below).
5. ~~Build the savings-estimate calculator.~~ Done — `savings.ts`, plus the rest of Phases 2–5's non-UI core: `pricing.ts`, `router.ts`, `cache.ts`, `context.ts`, `health.ts`.

All of the above is verified end-to-end via a real Vitest suite (`npm run test`, 84 tests) against three fixtures (AP invoice processing, support-ticket triage, content-moderation queue) and type-checks clean (`npx tsc --noEmit`).

## Next up — completed batch 2

1. ~~Add a real test suite.~~ Done — Vitest (`npm run test` / `test:watch`), 74 tests across all of `src/lib/workflow/*`, replacing the ad hoc `tsx -e` smoke tests. Assertions pin the exact numbers this file already claimed (AP fixture: 2 downgrade candidates, 51.8% savings vs. naive frontier, 44% model-step share, 1x–23x context bloat range, tightened-`minConfidence` escalation) so a future regression fails a test, not just an eyeballed diff.
2. ~~Second target workflow.~~ Done — [`src/lib/workflow/fixtures/support-ticket-triage.ts`](./src/lib/workflow/fixtures/support-ticket-triage.ts): inbound ticket → topic classification → known-issue lookup → sentiment/urgency → refund-policy check → account-risk assessment → drafted reply → human review → send. Structurally different from AP invoicing (free-text throughout, a refund/escalation path, no GL/invoice vocabulary) — validated in [`support-ticket-triage.test.ts`](./src/lib/workflow/fixtures/support-ticket-triage.test.ts).
   - **Generalization result, mixed.** The rules correctly generalized for keyword-shaped signals: `check_refund_eligibility` (fixed policy table + boolean output) → `deterministic`; `classify_topic` and `check_known_issue` (categorization/mapping language) → `cacheable`; `assess_account_risk` (fraud/unusual/explain-why language) → `complex-judgment`, matching `flag_anomaly`'s role in the AP fixture.
   - **Real gap found:** `assess_sentiment_urgency` and `draft_reply` match *no* rule (no policy/threshold/categorization/extraction keywords) and fall through to the safe default (`complex-judgment`, confidence 0.3) — even though both are plausibly bounded, small-model-solvable tasks. Correct per "escalate, don't under-classify," but it's real missed savings: this fixture's overall savings-vs-naive-frontier comes out to **36.3%**, well below the AP fixture's 51.8%, precisely because these two steps stack up on frontier by default. This is exactly the gap item 3 below now addresses.
3. ~~Prompt-based classifier fallback.~~ Done — [`src/lib/workflow/classify-model.ts`](./src/lib/workflow/classify-model.ts) (`classifyStepWithFallback`/`classifyTraceWithFallback`). Provider-agnostic by design: takes a `ModelClassifier` function as a dependency (caller wires up whatever LLM client/API key they have) and only calls it for steps the rules left at fallback confidence (default: ≤0.5) — the model call is the exception path, not the default. Falls back to the rules result (doesn't throw) if the model call errors. Verified against the support-ticket-triage gap above: a mock classifier correctly reclassifies `assess_sentiment_urgency`/`draft_reply` as `simple-judgment` while leaving already-confident rule matches (e.g. `assess_account_risk`) untouched — see [`classify-model.test.ts`](./src/lib/workflow/classify-model.test.ts). No real model wiring yet — that's a product/deployment decision (which provider, which prompt), not a library one.
4. **Per-task benchmarking (Phase 2.4).** Still open — needs real labeled input/output samples per task; can't be done against synthetic fixtures.
5. ~~Wire Product Wedge A end-to-end.~~ Done — [`src/cli/analyze.ts`](./src/cli/analyze.ts) (`npm run analyze -- <path-to-trace.json>` or `npm run analyze -- --fixture <ap-invoice|support-ticket-triage>`). Runs ingest → classify → route → savings → health end-to-end against a raw trace file and prints `formatSavingsReport()` plus classification breakdown, routing split, and health flags — the actual shareable audit artifact, no longer just a library. Handles malformed JSON and invalid traces with a clean error + usage message instead of a stack trace.

## Next up — completed batch 3

1. ~~Wire real model calls into the prompt-based fallback.~~ Done — [`src/lib/workflow/providers/anthropic-classifier.ts`](./src/lib/workflow/providers/anthropic-classifier.ts) (`createAnthropicClassifier`), a concrete `ModelClassifier` backed by the Claude API (`@anthropic-ai/sdk` + `zod`, via `client.messages.parse` + `zodOutputFormat` for a schema-validated response — no hand-rolled JSON parsing). Model defaults to `claude-opus-5` but is a constructor param, since this classification call is itself exactly the "bounded, small-model-solvable" shape this project's thesis says shouldn't default to frontier. Wired into the CLI as `--model-fallback` (reads `ANTHROPIC_API_KEY` from the environment; degrades to rules-only with a printed warning, not a crash, if it's unset). Tests mock the Anthropic client — no real network calls in the suite. No live key was available in this environment to do a real end-to-end run; the integration is unit-tested against the SDK's response shape but not yet fired against the real API.
2. **Per-task benchmarking (Phase 2.4).** Still open — needs real labeled input/output samples per task; can't be done against synthetic fixtures.
3. ~~A third, more adversarial fixture.~~ Done — [`src/lib/workflow/fixtures/content-moderation-queue.ts`](./src/lib/workflow/fixtures/content-moderation-queue.ts): a numeric (non-boolean) toxicity score, a nested multi-field decision object, and a step whose description mentions "policy threshold" only to say a fixed rule *doesn't* fully apply. This one **found and fixed a real classifier bug**, not just a gap:
   - **Bug found and fixed:** `assess_borderline_context` ("weigh context... that a fixed score can't capture") was matching `fixed-rule-or-threshold` on the incidental "policy threshold" mention + a boolean output, and got classified `deterministic` at 0.8 confidence — the dangerous direction, a genuine judgment call silently downgraded to plain code. Fixed in `classify.ts` with a new `context-sensitivity-override` rule (runs before `fixed-rule-or-threshold`) that catches "can't capture / weighs context / nuance / case-by-case / subjective / cultural context / judgment call" framing and forces `complex-judgment` instead. Regression-tested in [`content-moderation-queue.test.ts`](./src/lib/workflow/fixtures/content-moderation-queue.test.ts).
   - **Blind spots documented, not yet fixed:** a raw numeric threshold score (`score_toxicity`) and a nested-object policy-table output (`decide_action`) both evade `outputLooksLikeSmallEnum` (booleans/small-enum strings only) — the first falls safely to the conservative default (missed savings, not a correctness risk), the second gets `cacheable` via an unrelated keyword collision on "category" in the prose rather than the correct, better-reasoned `deterministic` path. Left as documented follow-up rather than patched now — see "Next up" below.
4. **Real trace ingestion.** Still open — everything validated so far is against hand-authored fixtures (now three, spanning invoice processing, ticket triage, and content moderation). The actual product wedge needs a real (anonymized/synthetic-but-realistic) customer trace to validate against — also a prerequisite for #2.
5. ~~CLI output formats.~~ Done — `npm run analyze -- ... --json` emits a machine-readable report (classifications, routing decisions, health, full savings breakdown) instead of the plain-text one, for a future dashboard or CI check to consume without re-parsing text.

## Next up — completed batch 4

1. ~~Fix the two documented blind spots in `outputLooksLikeSmallEnum`.~~ Done — `classify.ts`: `outputLooksLikeSmallEnum` now also recognizes a small plain-object output (≤4 fields, all short strings/booleans), which correctly moves `decide_action` from a coincidental `cacheable` (via an unrelated "category" keyword collision) to the higher-confidence, correctly-reasoned `deterministic` path. Deliberately did **not** extend it to bare numbers — a numeric score is a judgment call about *what* the number should be, not a rule lookup. Instead added a new `bounded-scoring-rubric` rule (numeric output + "score"/"rating"/"rubric" language + a bounded-scale mention, e.g. "0-100") that correctly classifies `score_toxicity` as `simple-judgment` instead of falling to the conservative default. Both regression-tested in `classify.test.ts` and `content-moderation-queue.test.ts`; no regressions on the other two fixtures.
2. **Fire the Anthropic model-fallback against a real trace.** Still blocked — needs an `ANTHROPIC_API_KEY` in this environment.
3. **Per-task benchmarking (Phase 2.4)** and **real trace ingestion.** Still blocked — both need a real (or realistic anonymized) customer workflow trace.
4. ~~CLI `--json` consumer.~~ Superseded — done bigger than planned: a full dashboard UI now consumes the pipeline over HTTP (see "Dashboard UI" under Phase 5 above) rather than just a JSON-output CLI flag being read by something.
5. ~~Test coverage for the API route + dashboard.~~ Done — [`src/app/api/analyze/route.test.ts`](./src/app/api/analyze/route.test.ts) (10 tests, GET+POST, both directly against the route handlers — no server needed) and [`src/app/dashboard.test.tsx`](./src/app/dashboard.test.tsx) (8 tests, `@testing-library/react` + jsdom, mocked `fetch`). `vitest.config.ts` now aliases `@/*` (Vite doesn't read `tsconfig.json` paths on its own) and matches `*.test.tsx`.
6. ~~Custom trace upload in the dashboard.~~ Done — `POST /api/analyze` accepts `{ trace, modelFallback? }` and runs the same pipeline as `GET` after `ingestWorkflowTrace` validation; the dashboard has an "Upload trace…" control (client-side JSON parse for immediate feedback, server-side `ingestWorkflowTrace` validation for the real check) alongside the three built-in fixture buttons.
7. ~~CI.~~ Done — [`.github/workflows/ci.yml`](./.github/workflows/ci.yml): lint, `tsc --noEmit`, `npm test`, `npm run build` on every push/PR to `main`. Badge in README.

## Next up

1. **Fire the Anthropic model-fallback against a real trace** once an `ANTHROPIC_API_KEY` is available — validate `providers/anthropic-classifier.ts` end-to-end (not just against the mocked SDK response shape), and record actual classification quality/cost.
2. **Per-task benchmarking (Phase 2.4) and real trace ingestion** — both still blocked on a real (or realistic anonymized) customer workflow trace.
3. **A LICENSE file** — none exists yet; needed before treating this as a shareable/open-source artifact.
4. **Dashboard error boundary / empty states** — the dashboard currently assumes every response is well-formed; a truly malformed `/api/analyze` response (not just an `{error}` body) isn't handled gracefully.
