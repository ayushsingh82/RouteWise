# PLAN.md — tokenmax

Problem statement: [`README.md`](./README.md). This plan turns the thesis ("spend intelligence sparingly — code where deterministic, small models where sufficient, cache where repeatable, frontier only where judgment is required") into a buildable system, broken into phases and points.

## Phase 0 — Foundations (current)

- [x] Repo scaffolded: Next.js (App Router, TS, Tailwind, ESLint).
- [x] README.md with problem statement + core thesis.
- [ ] COMPETITORS.md — landscape of who else is building model routing / token-cost optimization.
- [ ] Decide product wedge (see "Product wedge options" below) before writing app code.

## Phase 1 — Task decomposition engine

The unit of automation is the task, not the workflow. Before anything can be routed, a workflow needs to be broken into discrete steps.

1. **Workflow ingestion** — accept a workflow definition (a sequence of steps: trigger → actions → branches) from a config file, a trace/log of a past agent run, or a manual step-by-step description.
2. **Step extraction** — parse/normalize each step into a unit with: inputs, outputs, current implementation (model call vs code), and dependencies on prior steps.
3. **Task classification** — for each step, tag it as one of:
   - `deterministic` — output is a pure function of input (field match, data move, rule application) → replace with code.
   - `cacheable` — same input has recurred before with a known-correct output → serve from cache.
   - `simple-judgment` — requires interpretation but within a narrow, well-bounded decision space → route to a small/cheap model.
   - `complex-judgment` — ambiguous, high-context, or high-stakes → route to a frontier model or a human.
4. **Classification signals to use**: input/output cardinality (few discrete outcomes = deterministic candidate), historical output variance for the same input (low variance = cacheable/deterministic), presence of free-text/ambiguous input (judgment candidate), downstream cost of a wrong answer (escalation candidate).

## Phase 2 — Routing layer

1. **Model/resource registry** — a config of available resources: code rules engine, cache store, small models (e.g. Flash-tier), mid models, frontier models, human-in-the-loop queue — each with a cost-per-call and latency profile.
2. **Router** — given a classified task, pick the cheapest resource with acceptable reliability for that task type. Default distribution to aim for: **90% non-frontier / 9% near-frontier / 1% frontier** (the "90/9/1 split").
3. **Escalation policy** — escalate up a tier when: confidence score is low, output fails a validation check, or the task is flagged high-cost-of-error. Escalation should be the exception path, not the default.
4. **Per-task benchmarking** — before wiring a task to a given model tier, benchmark candidate models against a labeled sample of that task's historical inputs/outputs; pick the smallest model that clears the accuracy bar, not the largest available.

## Phase 3 — Caching layer

1. **Cache key design** — define what "same input" means per task (exact match vs normalized/fuzzy match, e.g. "stapler" → "office supplies" GL code).
2. **Cache store** — key/value store of input signature → validated output, with confidence/provenance (was this cached value ever human-corrected?).
3. **Invalidation policy** — rules change, categories get renamed, etc. — cache entries need a TTL or a review trigger, not infinite trust.
4. **Cache-hit accounting** — every cache hit should be logged as tokens saved, feeding the ROI dashboard (Phase 5).

## Phase 4 — Context/harness minimization

1. **Context scoping per task** — each routed call gets only the fields/documents relevant to that specific decision, not the full workflow history.
2. **Context templates per task type** — define, per task, the minimal schema of what the model actually needs to see.
3. **Measure context bloat** — track average input tokens per call per task; flag tasks whose context size is growing without a corresponding accuracy gain.

## Phase 5 — Measurement / ROI dashboard

1. **Track ROI on intelligence, not raw spend**: value delivered (task solved, error avoided) per dollar of token spend, per task type.
2. **Track the 90/9/1 split in practice** — what % of calls are actually landing on non-frontier / near-frontier / frontier, and drift over time.
3. **Track savings vs. the "everything on frontier" baseline** — the number that produces the ">90% reduction" headline.
4. **Track cache hit rate** and deterministic-code coverage per workflow, as leading indicators of how "agentic" a workflow actually needs to be.
5. **Flag workflows still running workflow-level (single frontier model reasoning through everything)** as decomposition candidates.

## Product wedge options (decide before building app UI)

- **A. Workflow analyzer / audit tool** — ingest an existing agent's trace logs, classify each step, and output a report: "X% of your calls could be code, Y% could be a cheap model, Z% must stay frontier," with estimated $ savings.
- **B. Routing proxy/gateway** — a drop-in LLM API layer that sits in front of existing agent code, classifies+caches+routes calls automatically (similar shape to an LLM gateway, but decomposition-aware rather than just picking a model per call).
- **C. Framework/SDK** — a library for building agents where task classification and routing are first-class primitives from day one, instead of retrofitted.

Recommendation: start with **A** (analyzer/audit) — it's the smallest surface area, produces an immediately shareable artifact (the savings report), validates the classification logic against real traces, and can be upsold into B or C later.

## Explicit non-goals (for now)

- No UI work until the wedge (A/B/C) is chosen and the classification logic is validated against sample data.
- No fine-tuning or training of custom small models — routing across existing hosted models only, initially.
- No claim of exact "90%" savings without being able to compute it from real trace data — the number is a target/label to validate, not a guarantee to bake in.

## Immediate next steps

1. Write `COMPETITORS.md`.
2. Pick a first target workflow (something with real trace/log data available) to validate task classification against.
3. Build a minimal classifier (rules + prompt-based) for step → `deterministic | cacheable | simple-judgment | complex-judgment`.
4. Build the savings-estimate calculator (Phase 5.3) since it's the artifact that sells the rest of the product.
