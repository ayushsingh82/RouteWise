# COMPETITORS.md — tokenmax

Landscape scan of who else is building against the same problem the [README](./README.md) describes: cutting enterprise LLM/agent token spend by routing each unit of work to the cheapest sufficient resource (code / cache / small model / frontier model), rather than running everything through a frontier model.

Picked the 3 closest to the *core thesis* (decompose work → route by required intelligence → control spend), not just any LLM-adjacent tool.

## 1. Not Diamond

- **What it is**: An AI model router. Trains a learned meta-model across 60+ LLMs that predicts, per incoming query, which downstream model will perform best — and retrains as new models ship.
- **Overlap with tokenmax**: Directly matches Phase 2 ("Routing layer") — picking the cheapest model that reliably clears the bar for a given task, automatically and per-call.
- **Gap vs. tokenmax's thesis**: Operates at the *query* level, not the *workflow-decomposition* level. It optimizes "which model should answer this prompt," not "should this step even be a model call, or code/cache instead." No explicit deterministic-code or caching layer — it's a router, not a decomposition engine.
- Source: [Fortune — "Why every company wants an AI model router right now"](https://fortune.com/2026/08/09/why-every-company-wants-an-ai-model-router-right-now/), [Not Diamond's own awesome-list](https://github.com/Not-Diamond/awesome-ai-model-routing)

## 2. Portkey

- **What it is**: An enterprise AI gateway sitting in front of LLM calls — unified API across providers, routing, semantic caching, guardrails, observability, and compliance controls.
- **Overlap with tokenmax**: Matches Phases 2–4 closely — routing (cheapest sufficient model), caching (Phase 3, "reuse known outputs instead of regenerating"), and some context/observability tooling (Phase 4/5). Widely cited as the top pick for "enterprise compliance" among LLM routers in 2026.
- **Gap vs. tokenmax's thesis**: A generic gateway/infra layer, not opinionated about *task classification* (deterministic vs. cacheable vs. simple-judgment vs. complex-judgment) or about producing an audit/savings report per workflow. It's plumbing a team wires up themselves; tokenmax's wedge (per the plan's "Product wedge A") is the analysis and classification on top of that plumbing.
- Source: [Braintrust — "Best LLM routers and model routing platforms in 2026"](https://www.braintrust.dev/articles/best-llm-routers-2026)

## 3. Portal26 (Agentic Token Control)

- **What it is**: A cost-governance module for AI agents — real-time token governance, policy-based spend limits per agent/workflow/org, adaptive safeguards (throttle/pause/terminate on runaway loops), and spend predictability/visibility.
- **Overlap with tokenmax**: Closest in *audience and framing* to Varick Agents' own pitch — enterprise, agent-specific, spend-control-first, marketed as "prevent runaway agent spend." Matches Phase 5 ("Measurement / ROI dashboard") most directly.
- **Gap vs. tokenmax's thesis**: Fundamentally a *governance/circuit-breaker* layer (limit and stop excess spend after the fact) rather than a *routing/decomposition* layer (avoid the spend in the first place by never calling a frontier model when code or a cheap model would do). Reactive cost control, not proactive task-to-resource matching.
- Source: [Businesswire — "Portal26 Launches Industry-First AI Agentic Cost Controls to Prevent Runaway Spend"](https://www.businesswire.com/news/home/20260423349657/en/Portal26-Launches-Industry-First-AI-Agentic-Cost-Controls-to-Prevent-Runaway-Spend)

## Honorable mentions (not in the top 3, but adjacent)

- **Martian** — real-time LLM router positioned around *interpretability* (explaining why a given model was chosen). Similar shape to Not Diamond, smaller mindshare.
- **OpenRouter** — largest model marketplace/unified gateway (623+ models); more of a distribution/access layer than a cost-optimization brain.
- **LiteLLM** — open-source, self-hosted proxy/router; the DIY option teams reach for before buying a platform.
- **RouteLLM** (Berkeley, open framework) — publishes hard routing benchmarks (~95% of frontier quality while sending only 14–26% of calls to the strong model); a reference point for tokenmax's own routing-quality claims, not a company/competitor.

## Where tokenmax's wedge differs from all of the above

None of the three above start from **workflow decomposition into individual tasks with an explicit `deterministic / cacheable / simple-judgment / complex-judgment` classification**, then route+cache+govern per task type, then report the savings against an "everything on frontier" baseline. Not Diamond and Portkey solve *routing*; Portal26 solves *governance*; none solve *decomposition* — which is the step this project's plan (see [PLAN.md](./PLAN.md), Phase 1 and Product Wedge A) treats as the actual unlock ("90% of spend never needed to happen because the step never needed a model at all").
