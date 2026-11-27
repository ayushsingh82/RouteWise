# COMPETITORS.md — RouteWise

Landscape scan of who else is attacking LLM/agent token spend by routing, caching or compressing. Researched **2026-11-27** with WebSearch plus direct page fetches. The strategic conclusions are in [`DIFFERENTIATION.md`](./DIFFERENTIATION.md); this file is the evidence.

**Confidence tags** — every claim carries one:

- **[V]** read on a primary page (vendor docs/pricing, paper, press release) during this research.
- **[S]** seen only in search snippets or third-party writeups; not confirmed on a primary page.
- **[U]** unverified, conflicting, or not stated anywhere I could read. Never treat as fact.

**Rule used throughout:** a vendor's savings percentage is a *claim about the vendor's workload*, not a measurement of yours. Where no method is published, the number is listed as a claim and nothing is inferred from it. No savings figure in this repo's docs is endorsed unless it's flagged as measured *and* the method is reproducible.

## What changed since the last version of this file

- **Mentlio, previously the "main competitor", was acquired.** Factory announced it on 2026-10-09 ("Mentlio (YC S26) is joining Factory"); the YC page lists the company as *Inactive* [V: [factory.com/news/mentlio](https://factory.com/news/mentlio), [YC](https://www.ycombinator.com/companies/mentlio)]. Whether the standalone product survives is **not stated** [U]. The threat is now "Factory's in-harness routing", not an independent startup.
- **Portkey was acquired by Palo Alto Networks** (announced 2026-04-30, closed 2026-05-29 per PANW material [S]; docs now say "Portkey is now PRISMA AIRS AI Gateway" [V]). Its pricing URL now redirects to Palo Alto [V]. It is becoming a security product.
- **Helicone** entered maintenance mode after Mintlify acquired it (2026-03-03) [V: [Mintlify](https://www.mintlify.com/blog/mintlify-acquires-helicone)]; its homepage separately says it is "now part of Experiential Labs" [V: helicone.ai]. Ownership is **conflicting** [U].
- **Langfuse** was acquired by ClickHouse (announced 2026-01-16) [S: [Langfuse](https://langfuse.com/blog/joining-clickhouse)].
- **Routers moved from per-call to per-step/session** (OpenRouter, Not Diamond, Ramp, LiteLLM, Requesty all now have session stickiness or step-level logic). "Only picks a model per call" is no longer a fair description of the leaders — see each entry.
- **New entrants:** Ramp's Router (launched 2026-08-20) and the open-source vLLM Semantic Router. Details below.

---

## 0. Mentlio → Factory

**What it was.** A local desktop agent beside Claude Code/Codex/Cursor with five savers (Route, Lens, Quiet, Logs, Recall). Full archived docs: [`research/mentlio/`](./research/mentlio/).

1. **Technique.** Per-turn model routing, semantic code search, response shaping, log compression, reversible compression of tool output. Factory's announcement describes the work as "in-harness model routing and context compression" plus measurement of where AI usage creates value [V: factory.com/news/mentlio].
2. **Decomposition.** No. Per-turn heuristics inside coding agents; no step graph, no "replace with code".
3. **Pricing / proof.** Demo-only, no public price list [V: mentlio.com]. Headline claims: "~30% of AI spend" (YC blurb) and "up to 40%" waste (site) — **no published method for either** [V that the claims exist; U on truth]. Its research posts are *replay benchmarks, explicitly not production trials*: Terminal-Bench 2.1 (89 tasks), retained 98.93% of always-frontier solved-task rate at 24.90% lower per-task cost; SWE-Bench Pro replay, 96.32% sufficiency at 20.66% lower cost [V: [terminal-bench-2-1](https://www.mentlio.com/research/terminal-bench-2-1), [fable-era-routing](https://www.mentlio.com/research/fable-era-routing), both July 2026]. Its own savings-methodology page separates benchmark-modeled from invoice-verified (see [`research/mentlio/savings-methodology.md`](./research/mentlio/savings-methodology.md)) — the model for our evidence tiers.
4. **Integration / privacy.** Desktop agent + dashboard; "prompts and source code on-device", dashboard receives aggregate scores [V]. Local-first.
5. **Benchmarks.** Above; data/code reproducibility not established [U].
6. **Complaints.** None found. Notable gap: no customer case studies on the pages read [V].

---

## 1. OpenRouter

1. **Technique.** Gateway to many models with a *router product*. Two generations: Aug 2026 = a ~30-task-type classifier + a 7-day "market spend" signal + a cost tier [V: [announcement](https://openrouter.ai/blog/announcements/introducing-the-new-auto-router/)]; Nov 2026 = a fast decision model that "rates eleven things" per request, then a policy weighing live price, cache status and benchmark performance, with session stickiness [V: [new Auto/Auto Code](https://openrouter.ai/blog/announcements/auto-and-auto-code-routers/)]. Also provider fallback on errors [V: [FAQ](https://openrouter.ai/docs/faq)].
2. **Decomposition.** Per-request, with session pinning (~9 in 10 agent turns stayed on one model in beta, their figure) [V]. Not a workflow graph.
3. **Pricing / proof.** Inference at list price; fee on credit purchases: 5.5% ($0.80 min) Standard, 8% Business; BYOK free to $25k/mo list then 5%; router adds no fee [V: [pricing](https://openrouter.ai/pricing), [FAQ](https://openrouter.ai/docs/faq)]. Proof = vendor benchmark tables with "±" undefined and no sample sizes; the Aug table shows the new default *costing 88% more* than the old default on one benchmark (DSQA: $276 vs $147; my arithmetic on their table) while saving 64% on MMLU-Pro [V]. Nov claims ("up to 4×", "74% less per task, in line with Opus 5.5") give **no methodology in the post**; it points to a benchmarks page I did not fetch [V that claim exists; U on method].
4. **Integration / privacy.** Hosted proxy/API; router available only in the global data region [V]. Prompts transit OpenRouter.
5. **Reproducibility.** Not reproducible from the posts. **Independent evidence cuts against it**: LLMRouterBench (Jan 2026, 391,645 instances, 33 models, code public) reports OpenRouter's router below the best single model, −24.7% in the paper's text [S for the exact figure — read via a summary; the paper's wording that commercial routers "fail to reliably outperform" the best single model is [V]]. Caveat: that predates the Aug/Nov redesigns, so it measures an older router.
6. **Complaints.** Credit-purchase fees; no SLA with outages reported 2026-02-17/19; Trustpilot 1.7/5 on 41 reviews (May 2026); provider output-quality variance on the same weights [S — secondary blogs, several from competitors].

## 2. Martian

1. **Technique.** Marketed as predicting per-model performance on a request without running it, rooted in interpretability research [S]. **Not documented on any page I could read** — the router deep links 404; today's docs list a *Gateway* ("unified access to 200+ models… pick the most effective model") with no algorithm described [V: [docs.withmartian.com/gateway](https://docs.withmartian.com/gateway)].
2. **Decomposition.** Per-query [S].
3. **Pricing / proof.** Pricing not stated [U]. Headline "outperforms GPT-4, ~20% cost reduction" is a 2023 Martian claim repeated by aggregators; a "20–97%" range on a directory is untraceable to Martian [S].
4. **Integration.** Gateway with OpenAI/Anthropic-compatible APIs [V]. Accenture invested (2024) [S].
5. **Benchmarks.** Offers a benchmarking tool; no independent or reproducible result found [U]. The homepage now leads with a research lab identity (ARES, K-Steering, interpretability) and doesn't mention a router [V].
6. **Complaints.** None found.

## 3. Not Diamond

1. **Technique.** A learned "meta-model" router. *Custom routers* train on **your** eval data: inputs + each candidate model's response + a numeric score; 15-sample minimum, ≤10,000 samples/5 MB per job [V: [quickstart](https://docs.notdiamond.ai/docs/router-training-quickstart)]. 2026 repositioning: "Model Routing for Coding Agents" — per-*step* recommendation of model and reasoning effort using payload semantics, KV-cache state, implicit feedback, sub-agent architecture and compaction events, trained with RL on session outcomes; pre-trained coding router is early-access [V: [notdiamond.ai](https://www.notdiamond.ai)].
2. **Decomposition.** Step-aware for coding-agent sessions (new). Still routes among models; no code/cache resources [V on what's described].
3. **Pricing / proof.** $0.05 per million tokens routed, by application; enterprise custom [V: [pricing](https://www.notdiamond.ai/pricing)]. Claims: "cost savings 50%+", "at least 20–40% … without degradation", Rootly "+39% accuracy" — **no methodology**; the savings calculator says "Modeled at equivalent output quality" ($4.8M→$3.6M, 25%) = modeled, not measured [V that claims exist; U on truth].
4. **Integration / privacy.** SDK (`select_model`) alongside your gateway — "is not a gateway". Standard mode sends prompt text; a "privacy-preserving" mode claims it never sees payloads, using derived metadata. Added latency 100–150 ms (their figure). Zero-retention not stated [V].
5. **Benchmarks.** Trainable on *your* data, which is the reproducible part; published headline numbers are not.
6. **Complaints.** None found; OpenRouter's older Auto Router was Not Diamond-powered, the current one is described without it [V/S — sources conflict].

## 4. RouteLLM (LMSYS / Berkeley) — research baseline, not a company

1. **Technique.** Trained binary routers (similarity-weighted, matrix factorization, BERT, causal-LLM) deciding strong vs. weak model from Chatbot Arena preference data [V: [paper](https://arxiv.org/abs/2406.18665)].
2. **Decomposition.** No — single-turn, two-model.
3. **Proof.** Open and reproducible. Headline "over 2×" cost reduction; up to 75% vs a random router on MT-Bench; MT-Bench 3.66× at 95% of GPT-4 quality, MMLU 1.41× at 92%, GSM8K 1.49× at 87% for the GPT-4-Turbo/Mixtral pair [V — the per-benchmark table values were read via a summary: S]. The "85%" figure on the project page is the upper end across routers/benchmarks [S].
4. **Limits stated by authors.** Two-model setting, short single-turn prompts, distributions may differ [S — quotes unverified]. Savings vary 1.4×–3.7× by benchmark — a reminder that one number is meaningless without a workload.

## 5. LiteLLM (BerriAI)

1. **Technique.** Open-source (MIT) SDK + proxy: load balancing, fallbacks, cost-based and latency-based routing, caching (in-memory, Redis, S3/GCS, **semantic** via Redis/Qdrant/Valkey with a `similarity_threshold`) [V: [caching](https://docs.litellm.ai/docs/caching/all_caches)]. 2026 *Auto Router v2* (shipped ~v1.94, 2026-07-13) merged routers into a `complexity_router`: keyword rules, a **zero-API-call heuristic scorer over seven text dimensions**, an optional LLM classifier, embedding-based keyword matching, Thompson-sampling over a tier's model pool, opt-in session affinity [V: [auto routing](https://docs.litellm.ai/docs/proxy/auto_routing), [v2 post](https://docs.litellm.ai/blog/autorouter-v2)].
2. **Decomposition.** No — per request, optional session affinity.
3. **Pricing / proof.** Core and gateway free; Enterprise (SSO/SCIM, audit logs, support) quote-based [V: [enterprise](https://docs.litellm.ai/docs/enterprise)]. **Best-in-class honesty:** their own benchmark (300 prompts, 3-model Gemini cost ladder, blinded cross-family judge, 95% CIs, a cost-matched *shuffled control*) found the semantic router beat the control (+7.7 pts at 58% savings, CI [+3.8,+11.5]) but the heuristic complexity router did **not** (fitted +2.3, CI [−0.2,+4.8]; scorer AUC 0.524 ≈ chance; judge disagreed with itself on 32% of pairs). Quote: "The rule-based complexity score was not predictive of when the cheap model would produce an acceptable answer." No byline/date; code/data release not mentioned [V: [benchmark](https://docs.litellm.ai/docs/proxy/auto_routing_benchmark)].
4. **Integration / privacy.** Self-hosted proxy: prompts stay in your infrastructure. Proxy docs themselves warn semantic caching "goes badly wrong on agentic traffic" [V].
5. **Reproducibility.** Dataset composition is public (WildChat, MATH-500/MMLU-Pro, BigCodeBench); harness release unclear [V/U].
6. **Complaints.** Official incident reports: OOM kills from retry-breadcrumb memory growth in v1.100.0 (2026-09); proxy outages when Postgres was unreachable (2026-04); supply-chain compromise notices in 2026-03 and malicious PyPI build 1.107.0 (2026-10-21); several CVEs [S — official posts and Check Point/CSA seen in search, not fetched]. Community posts on memory/latency are anecdotal [S].

## 6. Portkey (now Palo Alto Networks' Prisma AIRS AI Gateway)

1. **Technique.** Gateway: fallbacks, retries, load balancing, **conditional routing**, caching. Simple cache = exact match, all plans; **semantic cache only on select Enterprise plans**, cosine ≥0.95 default, requests ≤8,191 tokens and ≤4 messages, **system prompt ignored for matching**, other params must match exactly; reported as "up to 20× faster and cheaper", no hit-rate stated [V: [cache docs](https://portkey.ai/docs/product/ai-gateway/cache-simple-and-semantic)]. Conditional routing matches `metadata`, `params`, `url.pathname` — *not prompt content or complexity* [V: [docs](https://portkey.ai/docs/product/ai-gateway/conditional-routing)].
2. **Decomposition.** No. Rule-based routing on request metadata.
3. **Pricing / proof.** Earlier tiers ($49/mo "Production", $9 per 100K overage) [S]; pricing page now redirects to Palo Alto [V] → current pricing **unknown** [U]. No savings methodology beyond "up to 20×".
4. **Integration / privacy.** Hosted or self-hosted gateway; the repo license could not be confirmed [U].
5. **Complaints.** Semantic cache gated to enterprise; strategic risk from acquisition-into-security-product (inference, not reported complaint).

## 7. Helicone

1. **Technique.** Gateway + observability; **exact-match** caching in Cloudflare Workers KV, optional "bucket" caching returning one of N stored responses at random (max 20), 7-day default / 365-day max TTL [V: [docs](https://docs.helicone.ai/features/advanced-usage/caching)].
2. **Decomposition.** No.
3. **Status.** Maintenance mode since the Mintlify deal (2026-03-03); homepage separately "now part of Experiential Labs"; Mintlify's migration letter link 404s [V]. Treat as end-of-life for roadmap purposes.
4. **Proof.** None found. **Complaints.** Migration pressure from competitor blogs [S].

## 8. Langfuse (ClickHouse)

1. **Technique.** **Observability only for cost**: cost = ingested usage/cost from the LLM response, or inferred from submitted usage × a model price table; *no longer estimates tokens from text* (changelog 2026-11-06) [V: [docs](https://langfuse.com/docs/model-usage-and-cost)]. No routing or response caching described on pages read ("prompt caching" there means prompt-management fetches) [V]. A pricing row lists "AI Gateway" without describing behavior [V/U].
2. **Decomposition.** Traces/observations/spans exist, but no classification into code/cache/model.
3. **Pricing.** Hobby free (50k units); Core $29; Pro $199; Enterprise $2,499/mo; overage $8 per 100k units graduated; self-host free (open source) [V: [pricing](https://langfuse.com/pricing)]. A "unit" is any trace/observation/score.
4. **Integration.** SDKs, OpenTelemetry (`gen_ai.usage.*`, `llm.token_count.*`), framework integrations, gateway logging (LiteLLM/OpenRouter cost fields) [V]. **This is the largest pool of existing traces** — an adapter target.
5. **Proof / complaints.** None relevant (doesn't claim savings).

## 9. Braintrust

1. **Technique.** Evals/observability platform with a **gateway** (public preview, free, **no SLA**): response cache (`auto` = only when temperature 0 or seed set; 1-week default TTL, encrypted with a key derived from your API key), provider failover; the older proxy is deprecated [V: [gateway](https://docs.braintrust.dev/deploy/gateway.md), [proxy](https://docs.braintrust.dev/deploy/ai-proxy)]. No cost-based routing described.
2. **Decomposition.** No (but its eval workflow is exactly how per-task model choices would be validated).
3. **Pricing.** Starter $0; Pro $249/mo; Enterprise custom; evals/experiments unlimited on all tiers [V: [pricing](https://www.braintrust.dev/pricing)].
4. **Proof / complaints.** No savings claims on pages read; "gateway free during beta" / no SLA is the practical caveat [V].

## 10. Arize (Phoenix + AX)

1. **Technique.** Tracing and evals built on OpenTelemetry/OpenInference; Phoenix OSS/"local-first", AX managed [V: [docs](https://arize.com/docs/phoenix), [pricing](https://arize.com/pricing/)]. AX Free $0 (25k spans), Pro $50/mo (50k spans), Enterprise custom [V]. Phoenix license is disputed between sources (Elastic License 2.0 per a competitor) [U].
2. **Decomposition — the interesting part.** Arize's Sept 2026 article, *"How I cut coding agent costs with model and harness routing"*, **manually** assigns planning/exploration/implementation/review to different models: "from roughly $100 to $15–$20 per run" on one workflow. The author states they "did not run repeated, matched trials that established equal recall, precision, or severity", n≈1, advocacy not study; recommends metric = cost per *accepted outcome* [V: [arize.com/?p=31923](https://arize.com/?p=31923)]. It validates the thesis (phase-level routing) while showing nobody has automated or measured it.
3. **Integration.** OTLP ingest + instrumentation for most frameworks [V].

## 11. Vercel AI Gateway

1. **Technique.** Unified endpoint, ordered provider/model fallbacks, `caching: 'auto'` = **provider-side prompt caching** (you pay the cache-read rate); to reuse full responses "cache them in your application" [V: [docs](https://vercel.com/docs/ai-gateway)]. No model-selection/"auto" router described [V/U].
2. **Pricing.** No markup, no platform fee on tokens (also BYOK); add-ons e.g. $0.10/1k requests for team-wide provider allowlist or ZDR, regional hosting +5% [V: [pricing](https://vercel.com/docs/ai-gateway/pricing)].
3. **Proof.** None needed — it doesn't claim savings beyond passing through cache discounts.

## 12. Cloudflare AI Gateway

1. **Technique.** Exact-match cache (SHA-256 of provider, endpoint, model, auth header, full body; TTL 60 s–1 month); **no semantic cache** ("we plan on adding"). Dynamic routing nodes: Conditional, Percentage (A/B), Model, Rate Limit, Budget Limit — rules read **metadata only, not the request body**; OpenAI chat-completions shape only (Anthropic format returns 400) [V: [caching](https://developers.cloudflare.com/ai-gateway/features/caching/), [dynamic routing](https://developers.cloudflare.com/ai-gateway/features/dynamic-routing/)].
2. **Pricing.** Core features (analytics, caching, rate limiting) free; log retention billed; 5% fee on Unified-Billing credits [V: [pricing](https://developers.cloudflare.com/ai-gateway/reference/pricing/)].
3. **Decomposition / proof.** None / none. Cheap, safe, and not trying to be smart.

## 13. Unify.ai

1. **Technique.** Per the (auth-gated) routing docs as seen in search: a neural scoring function trained on LLM-as-judge targets, with quality/latency/cost weights [S].
2. **Status.** Homepage now reads "Continual learning for AI teams — models that keep learning"; no routing product post since at least Sep 2026 [V: unify.ai]. Router status **unconfirmed** [U]. Treat as pivoted.

## 14. Requesty

1. **Technique.** 2025: in-house ~65M-parameter classifier (distilled from 50k labeled examples) → task label → YAML policy with budget/latency ceilings and fallback chain [V: [blog](https://www.requesty.ai/blog/smarter-than-human-model-picking-introducing-requesty-smart-routing)]. Oct 2026 *Auto Routing* (beta): a third-party "decision model" reads **only the first user message**, scores routes against a threshold, and **pins the choice for 60 minutes** per `trace_id` [V: [blog](https://www.requesty.ai/blog/introducing-auto-routing)]. Caching claims "30–60% hit rates", "up to 90% on repetitive workloads" — undocumented basis [V that claim exists].
2. **Decomposition.** Per session, first message only.
3. **Proof.** "42% lower model cost for the same tokens" = **repricing the same tokens on a different model, modeled latency, quality "not graded", "not independently verified"** per the post itself [V]. Earlier pages claim up to 80% and cite unnamed customers (78%, 40%); its own cost guide gives $720/mo in one place and ~$1,200/mo in another [V]. Pricing/markup not read [U].

## 15. 2026 newcomers and adjacent

- **Ramp Router** (launched 2026-08-20; [TechCrunch](https://techcrunch.com/2026/08/20/ramp-launches-its-own-ai-model-router-called-router/), [router.com](https://router.com/faq)). OpenRouter-style gateway with strategies: cost-efficient, cross-provider, **Switchyard** ("sends simpler turns to an efficient model while keeping harder turns on a frontier model"), Jev auto-routing, benchmark-weighted, and **"Shadow models"** (all Beta) [V: [docs.router.com](https://docs.router.com/strategies/workloads); I did not read the individual strategy pages, so what "shadow" means is [U]]. Free through 2026-12-31; from 2027 list price with no token markup, 2% fee on BYOK traffic; $500 credits; ZDR supported but router-side recording of prompts/outputs/tool calls is **on by default**; US-only at launch [V]. No savings figure published [V]. Ramp's angle: tying token spend to card/vendor data a standalone router can't see [S].
- **Factory (+Mentlio).** See §0.
- **vLLM Semantic Router** (open-source; [arXiv 2603.04444](https://arxiv.org/abs/2603.04444), Feb–Jun 2026). Routes on 13 composable signal types (semantic, safety, modality) via Boolean decision rules and a typed DSL; no quantitative results read [V abstract only; U on performance].
- **Portal26 Agentic Token Control** — governance/circuit breaker; carried over from the earlier version of this file, not re-verified [S].
- **Fortune's 2026-08-09 piece** and aggregator "router race" blogs ($3B valuation talk) are not primary evidence and are not relied on [U].
- Other tools surfaced (Lynkr, NadirClaw, Edgee, Bifrost MCP gateway) make savings claims (e.g. "92%" for Bifrost Code Mode) that are vendor-authored; not evaluated [U].

---

## Cross-cutting evidence (what nobody should ignore)

| Finding | Source | Why it matters here |
| --- | --- | --- |
| Commercial routers can fail to beat the best single model | [LLMRouterBench](https://arxiv.org/abs/2601.07206) (391,645 instances, 21 datasets, 33 models, code public) | The category's central claim is contested by the only large independent benchmark. Top methods got up to ~4% accuracy gain *or* up to ~31.7% cost reduction at matched accuracy [S — from a summary]. |
| A text-heuristic "complexity" score was ~random at predicting when a cheap model suffices (AUC 0.524) | [LiteLLM benchmark](https://docs.litellm.ai/docs/proxy/auto_routing_benchmark) | Directly threatens any rule/keyword classifier, including ours. |
| Savings from one router paper range 1.4×–3.7× by benchmark | [RouteLLM](https://arxiv.org/abs/2406.18665) | A single headline % is workload-dependent. |
| FrugalGPT's "up to 98%" is one dataset (HEADLINES); other datasets 59–73% in Table 3, "range from 50% to 98%" | [FrugalGPT](https://arxiv.org/abs/2305.05176) | The most-quoted figure in the field is a best case. Its three techniques — prompt adaptation, completion cache, cascade — are the canonical menu. |
| Semantic-cache error rates depend on threshold and dataset; static thresholds give no correctness guarantee; vCache reports up to 12.5× hit / 26× lower error with a user-set error bound | [vCache](https://arxiv.org/abs/2502.03771); GPTCache false-hit studies (MeanCache, InstCache) are by authors of alternatives | No independent production study found. Portkey and LiteLLM both fence semantic caching. |
| Prompt compression: LLMLingua "up to 20×" with little loss on its benchmarks; degrades at 25–30× on GSM8K | [LLMLingua](https://arxiv.org/abs/2310.05736) | Real lever; not what any gateway competitor sells. |
| Provider-native levers already exist: Anthropic cache reads are 0.1× base input (0.05× Opus/Sonnet 5.5, 0.025× Fable/Mythos per footnote); batch APIs are 50% off for ≤24 h turnaround at both Anthropic and OpenAI | [Anthropic caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching), [Anthropic batch](https://platform.claude.com/docs/en/build-with-claude/batch-processing), [OpenAI batch](https://developers.openai.com/api/docs/guides/batch) | Any honest savings report must separate "a router did this" from "turning on a discount the provider already offers". |

## Open questions (not resolved by this research)

- What Factory does with Mentlio's standalone product. [U]
- Martian's router algorithm and pricing; Unify's router status; Portkey's current pricing; Helicone's current owner. [U]
- Whether any competitor verifies cache hits or downgrades against recorded outputs before enabling them. **None of the pages read describe it**, but absence from the pages I read is not proof of absence.
- Whether any competitor replaces model calls with synthesized code. None found in the pages read.
