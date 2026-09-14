# RouteWise

[![CI](https://github.com/ayushsingh82/tokenmax/actions/workflows/ci.yml/badge.svg)](https://github.com/ayushsingh82/tokenmax/actions/workflows/ci.yml)

**A workflow analyzer that finds out how much of your agent's token spend never needed to happen.**

RouteWise decomposes an agentic workflow into its individual steps, classifies each one by how much intelligence it actually requires, and reports what it would cost to route every step to the cheapest resource that can reliably handle it — plain code, a cache lookup, a small model, or a frontier model — instead of running the whole workflow through one frontier model by default.

It ships as a library (`src/lib/workflow`) and a CLI (`npm run analyze`) that turns that library into a shareable savings report: the first deliverable of [Product Wedge A](./PLAN.md#product-wedge-options-decided), a workflow audit tool.

## Why this exists

Most workflows that look "agentic" from the outside are majority-deterministic once you break them down. A large share of what gets routed through a frontier model on every call is really a fixed rule, a repeated lookup, or a bounded judgment call a small model could handle — and only a small remainder genuinely needs frontier-level reasoning or a human. RouteWise exists to measure that split for a given workflow instead of asserting it.

See [Background](#background) for the full source article this project is built against.

## How it works

1. **Ingest** a workflow trace (a config file, an agent trace export, or a hand-authored definition) into a normalized, topologically-ordered sequence of steps.
2. **Classify** each step as `deterministic` (→ code), `cacheable` (→ lookup), `simple-judgment` (→ a small/cheap model), or `complex-judgment` (→ a frontier model or a human) — rules-based by default, with an optional LLM-backed fallback for steps the rules can't confidently place.
3. **Route** each step to the cheapest resource its classification and confidence justify, escalating to a safer tier when confidence is too low to trust.
4. **Cache** repeated input → output mappings so identical decisions aren't re-generated.
5. **Scope context** per step to only its declared inputs, and measure how much larger a naive full-workflow-history payload would have been.
6. **Report savings**: naive-frontier-baseline cost vs. current spend vs. recommended-routing cost, plus a health check that flags workflows still running mostly through a model.

## Getting started

```bash
npm install
npm run dev        # Dashboard at http://localhost:3000
npm test           # Vitest suite (src/lib/workflow/**, src/app/**)
```

### Web dashboard

`npm run dev` serves a dashboard (`src/app/page.tsx` + `src/app/api/analyze`) over the same ingest → classify → route → savings → health pipeline as the CLI: pick a built-in fixture, optionally enable the Claude fallback for unconfident steps, and see the savings breakdown, routing split, and step-by-step table render live. It currently only serves the built-in fixtures — uploading a custom trace goes through the CLI below.

### Run the analyzer (CLI)

```bash
# Against a built-in example workflow
npm run analyze -- --fixture ap-invoice
npm run analyze -- --fixture support-ticket-triage
npm run analyze -- --fixture content-moderation-queue

# Against your own workflow trace
npm run analyze -- path/to/trace.json

# Machine-readable output
npm run analyze -- --fixture ap-invoice --json

# Use the Claude API to classify steps the rules can't confidently place
# (requires ANTHROPIC_API_KEY; falls back to rules-only with a warning if unset)
npm run analyze -- --fixture ap-invoice --model-fallback
```

Sample output against the bundled AP invoice fixture:

```
Savings report — AP Invoice Processing (ap-invoice-processing)

  extract_line_items       simple-judgment    naive=$0.0795 current=$0.0795 recommended=$0.0013
  gl_code_line_item        cacheable          naive=$0.0270 current=$0.0270 recommended=$0.0001
  check_approval_threshold deterministic      naive=$0.0069 current=$0.0069 recommended=$0.0000
  flag_anomaly             complex-judgment   naive=$0.1043 current=$0.1043 recommended=$0.1043
  ...

Naive single-frontier-model baseline: $0.2194
Recommended spend:                    $0.1056
Savings vs. naive frontier baseline:  $0.1137 (51.8%)

Workflow health: DECOMPOSITION CANDIDATE
  - 2 step(s) classified deterministic/cacheable are still implemented as model calls: gl_code_line_item, check_approval_threshold.
```

## Project structure

```
src/
  app/
    page.tsx, dashboard.tsx    # Dashboard UI
    api/analyze/route.ts       # Server-side pipeline endpoint the dashboard calls
  lib/workflow/
    types.ts, ingest.ts       # WorkflowTrace ingestion, validation, topological ordering
    classify.ts                # Rules-based task classifier
    classify-model.ts          # Provider-agnostic LLM fallback for unmatched steps
    providers/                 # Concrete model-classifier implementations (Claude API)
    router.ts, pricing.ts      # Cheapest-sufficient-resource routing + tier pricing
    cache.ts                   # Input -> output cache with provenance/TTL
    context.ts                 # Per-step scoped context + bloat measurement
    savings.ts                 # Naive/current/recommended cost comparison + report formatting
    health.ts                  # Flags workflows still running mostly through a model
    fixtures/                  # Example workflows: AP invoicing, support-ticket triage, content moderation
  cli/analyze.ts                # Product Wedge A: the analyzer CLI
```

Each module's `*.test.ts` file is its unit test suite (Vitest, `npm test`).

## Status & roadmap

Phases 0–5's non-UI core are built and tested; see [`PLAN.md`](./PLAN.md) for the full phase-by-phase build log, what's still open (per-task benchmarking against real labeled data, real trace ingestion), and the product-wedge decision. [`COMPETITORS.md`](./COMPETITORS.md) has the competitive landscape scan, including the closest comparable product.

## Background

This project is built directly against the following source article:

**Source: [@vasuman on X](https://x.com/vasuman/status/2089436710257959073?s=20)**

> **Spend Less Tokens**
>
> You can cut your token spend by over 90% without using open source models.
>
> A year ago, token spend wasn't part of the conversation. I remember folks telling me that the technology was going to 'transform their business', so they weren't all that concerned about what they were spending on tokens. Nowadays it's easy to make fun of token-maxxing, but at the time this was rampant.
>
> Fast forward to today, and this has changed quite a bit. AI usage within large companies has gone up dramatically, with token spend alongside it. Productivity has gone up only marginally, and it certainly hasn't translated into the financial returns that most executives hoped for. Now, they want to know why the bill keeps growing, what they should be measuring, and how to bring down the cost of agents without reducing the efficiency gains.
>
> For context, I'm the CEO of @varickagents. We build agents for the largest companies on the planet. Our core focus is proving the largest possible efficiency gains for the cheapest possible token spend, and as a result, we've noticed the same patterns surfacing over and over again.
>
> Daniel, who runs our FDE team, recently wrote an article about how companies will soon manage token spend the way a trading firm manages capital: moving dollars away from lower-return use cases and reallocating them towards higher-ROI ones. This is more of the financial side. But what about the engineering side?
>
> If intelligence is expensive, how do you use as little intelligence as possible, while making sure the intelligence you do use is doing useful work for as cheap as possible? Through this framing, measurements become clear: you ought to track ROI on intelligence, not raw spend, or even spend per employee.
>
> Put simply: if $10 of Fable 5 solves 1 hard task, and $10 of Gemini 3.6 Flash solves 100 easy ones, the question becomes how many of your "hard" tasks are actually just bundles of "easy" tasks. Spoiler alert: it's most of them.
>
> **FIGURE 1: 1 hard task vs 100 easy tasks**
>
> Once you break down a complex workflow into individual steps, you realize most steps when calling models don't need SOTA intelligence at all. Some steps can be deterministic, some can use smaller models, and some outputs can be cached instead of generated again every single time.
>
> 90% of your company's token spend never needed to happen in the first place. Spend less tokens.
>
> ### Most enterprise workflows are deterministic
>
> One thing we started noticing pretty quickly once we went deeper on token spend was that a lot of the workflows people called agentic only needed LLM judgment in a few places, yet teams were using AI for all of it.
>
> From the outside, these workflows looked very complicated (writing to multiple systems, different paths the workflow could take, approvals/exceptions). We would look at the complex workflow and determine that we'd need a sophisticated agent with frontier AI to run it.
>
> But once we started going through these workflows step by step, we could see that a lot of the work the "agent" was doing was simple and deterministic: checking whether fields matched, moving data from one place to another, or just applying a rule. We realized these trivial tasks can be done with code, which is much cheaper, and we were wasting tokens by running them with expensive intelligence.
>
> What we've come to learn is that the number of steps in a workflow and the amount of intelligence required in that workflow are two very different things.
>
> Once you separate them out, a lot of enterprise workflows are mostly deterministic, with only a very small number of places where the model really needs to think. Anything deterministic can and should be done in code, meaning the AI in most of these workflows was overkill.
>
> **FIGURE 2: Judgement steps vs the entire workflow**
>
> ### The workflow is the wrong unit of automation
>
> Once we started looking at workflows this way, we realized we had been thinking about the wrong unit of automation.
>
> Models are now good enough where you can give them a lot of context and access to a few tools, and let them work through a pretty complicated process on their own. But that also means the model ends up being used in many areas where it wasn't really necessary, and blows through your token budget for seemingly no reason.
>
> That's the biggest design mistake we see: automating at the workflow level. Break the workflow down into the individual tasks inside it instead, because each task has a completely different intelligence requirement.
>
> Once you know exactly which workflow components require AI and which don't, you can be a lot more granular about where AI gets used, and you end up spending tokens only in the places that require judgment.
>
> These are mainly the parts of the workflow where you can't know the right answer ahead of time because it depends on the situation. For example, imagine an agent gets an email. That email might mean different things depending on what the customer was asking. Whenever the answer depends on background context and there's more than one plausible way to handle it, that's where a model becomes useful, because there's an actual judgment call to make.
>
> But the next mistake we see is pointing the heaviest frontier model at every task that requires a little bit of judgment. Our methodology is to break the workflow into individual tasks, then benchmark models against each one and use the smallest model that reliably handles it, instead of handing the whole thing to a frontier model in one call. By the end, we have a system that runs Gemini 3.6 Flash where possible and only reaches for Opus where absolutely necessary. The rough distribution is 90% non-frontier, 9% near-frontier, and 1% frontier. We call this the 90/9/1 split. Priced against running everything on frontier, that split is where the 90% at the top of this article comes from.
>
> **FIGURE 3: The 90/9/1 split is real**
>
> ### The model should become a smaller part of the system
>
> Once you assess how much intelligence a step really needs, you begin to realize most steps in a workflow don't need a powerful model. In fact, some steps don't need a model at all.
>
> Deterministic steps should be plain code (e.g. if we get an email, we should download its attachments, if it has any). Very plainly: If X, then Y.
>
> And simpler reasoning should go to smaller, cheaper models, like Gemini 3.6 Flash (e.g. read the line item on an invoice and if it's a stapler, call an LLM to GL Code it to the right category - in this case 'office supplies').
>
> And known outputs can be reused again from cache instead of generated net-new every single time (e.g. every time you read a line item, you should map its GL Code to the cache, so that whenever you see 'stapler' you know it's 'office supplies' without even calling the LLM).
>
> **FIGURE 4: The test against every step**
>
> ### Make every model call earn its place
>
> Start with the workflow as it actually runs today. You'll usually find many places where the outcome can be determined without a model. Those should just become code. If this, then that. You know, the good old-fashioned way.
>
> The remainder will be the small areas where judgment is required. Models are necessary there, but the steps don't all need the same amount of intelligence. A smaller model might be completely fine for one step, while another needs something stronger. With these steps, keep a human in the loop when there's a lot of judgment or domain knowledge required, or when the answer is too costly to get wrong.
>
> Context is another big area where tokens are being inefficiently spent. The past 2 years of building in applied AI have taught us that the harness around the model has a very big impact on the amount of tokens spent. A good harness prevents the model from being inundated with information that it doesn't need. If the decision comes down to just a few fields and maybe a single document, there's no reason to send the entire history of a workflow per LLM call. Narrow context is also more accurate, since irrelevant information is exactly where models get confused.
>
> **FIGURE 5: Don't feed the entire workflow history into every model call**
>
> ### TLDR
>
> - Many workflows that look agentic from the outside are majority-deterministic once you break them down.
> - You should rarely, if ever, let one model reason through an entire workflow, as opposed to breaking a workflow down into individual tasks, and then deciding task by task what actually needs a model.
> - For each task, inspect deeply the amount of judgment that is actually required. If the answer can be known ahead of time, use code. If some judgment is required, use the smallest model that can handle it reliably. If the downside of being wrong is high, escalate to a stronger model or a person.
> - Keep context as scoped down as possible, and reuse outputs when the same inputs keep showing up via caching.
> - Long story short: the goal is to spend intelligence sparingly, not just for token spend, but for accuracy as well.

### Core thesis

1. **Workflow → task decomposition.** The task, not the workflow, is the unit of automation.
2. **Classify every task** as deterministic (code), cacheable (lookup), cheap-model-solvable, or judgment-requiring.
3. **Route to the cheapest sufficient resource** — the 90/9/1 split (non-frontier / near-frontier / frontier).
4. **Cache aggressively** on repeated input → output mappings.
5. **Minimize context per call** — narrow, task-scoped context instead of full workflow history.
6. **Escalate on cost-of-error**, not by default — human-in-the-loop or a stronger model only when being wrong is expensive.
7. **Measure ROI on intelligence**, not raw token spend.

## Stack

[Next.js](https://nextjs.org) (App Router, TypeScript, Tailwind), [Vitest](https://vitest.dev) + [Testing Library](https://testing-library.com) for the test suite (`src/lib/workflow/**` and `src/app/**`), [`@anthropic-ai/sdk`](https://github.com/anthropics/anthropic-sdk-typescript). CI (`.github/workflows/ci.yml`) runs lint, typecheck, tests, and build on every push/PR to `main`.
