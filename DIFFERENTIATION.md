# DIFFERENTIATION.md — where RouteWise is different, where it only says it is

Evidence base: [`COMPETITORS.md`](./COMPETITORS.md) (researched 2026-11-27; confidence tags **[V]** verified on a primary page, **[S]** secondary/snippet, **[U]** unverified). Our side is judged from the code in `src/lib/workflow`, `src/lib/ingest`, `src/lib/shadow`, `src/lib/gateway`, `src/lib/report`.

**Ground rule.** No savings percentage appears below as a fact unless someone measured it with a published method. Where a competitor or this repo has a number, it is labelled a claim, and the sample-data numbers in this repo are explicitly *not* evidence (see §2).

---

## 1. Us vs. them

Legend: ● yes / documented · ◐ partial or beta · ○ no / not found in pages read · ? unknown. "Decomposes" means *classifies steps into non-model resources too*, not just picks a model.

| | Technique (one line) | Picks model per call | Per-step / session-aware | Decomposes into code / cache / model | Semantic cache | Savings proof offered | Trace import (no proxy) | Local-first / privacy |
|---|---|---|---|---|---|---|---|---|
| **RouteWise** | Rule+observed-stats classifier → 4 classes → tier; exact cache; shadow replay | ◐ (proxy, unproven on live traffic) | ◐ per task (system prompt), **no step graph** | ◐ classifies all 4, **only acts on cache + model tiers** | ○ | ● tiers: modeled→verified, shadow-verified cache hits | ● 5 formats | ● CLI/local; anonymizer |
| OpenRouter | Decision model rates 11 factors + live price/cache/benchmark policy | ● | ◐ session stickiness | ○ | ○ | ○ vendor tables, no method | ○ | ○ hosted |
| Martian | "Predict performance" (internals undocumented) | ● [S] | ? | ○ | ? | ○ old 20% claim | ○ | ? |
| Not Diamond | Learned meta-model, trainable on **your** eval data | ● | ◐ per-step in coding agents (early access) | ○ | ○ | ◐ trains on your data; headline % have no method | ○ | ◐ "privacy-preserving" mode |
| RouteLLM | Preference-trained strong/weak router | ● | ○ | ○ | ○ | ● open, reproducible, one model pair | ○ | ● self-run |
| LiteLLM | Heuristic/LLM/keyword complexity router; Thompson pools; routing strategies | ● | ◐ opt-in session affinity | ○ | ● (warns against on agentic traffic) | ● **own benchmark with CIs + shuffled control** | ○ | ● self-hosted |
| Portkey (PANW) | Gateway; metadata/param conditional routing | ◐ rules only | ○ | ○ | ◐ Enterprise-only | ○ | ○ | ◐ |
| Helicone | Exact-match cache gateway | ○ | ○ | ○ | ○ | ○ | ○ | ? (maintenance mode) |
| Langfuse | Observability + cost calc | ○ | traces only | ○ | ○ | ○ (not its job) | ● ingests traces | ● self-host |
| Braintrust | Evals + gateway (cache, failover) | ○ | ○ | ○ | ○ | ○ | ◐ | ○ |
| Arize / Phoenix | Tracing + evals (OTel/OpenInference) | ○ | traces only | ○ | ○ | ○ (article: n≈1, no matched trials) | ● | ● Phoenix local-first |
| Vercel AI Gateway | Fallbacks + provider prompt caching | ○ | ○ | ○ | ○ | ○ | ○ | ○ |
| Cloudflare AI Gateway | Exact cache; metadata-only routing rules | ○ | ○ | ○ | ○ (planned) | ○ | ○ | ○ |
| Unify | Neural scorer [S] — likely pivoted [U] | ? | ? | ○ | ? | ? | ○ | ? |
| Requesty | Classifier / third-party decision model on **first message**, pinned 60 min | ● | ◐ per session | ○ | ◐ claimed | ○ "modeled, not independently verified" | ○ | ○ |
| Ramp Router | Strategies incl. Switchyard (simple vs hard turns), benchmark-weighted, "Shadow models" (Beta) | ● | ◐ per turn | ○ | ○ | ○ none published | ○ | ◐ recording on by default, ZDR optional |
| Factory/Mentlio | In-harness routing + context compression (coding) | ● | ◐ per turn | ○ | ○ | ◐ replay benchmarks, no production trial | ○ | ● on-device measurement |

Reading the table: **the only columns where we are alone are "classifies into non-model resources", "savings proof tiers with shadow verification", and "multi-format trace import used for auditing"** — and the first is only half-implemented (§3).

---

## 2. Where our decomposition-first approach is *really* different

These hold up against the evidence in COMPETITORS.md.

1. **The taxonomy includes resources that aren't models.** `classify.ts` emits `deterministic / cacheable / simple-judgment / complex-judgment`, and `router.ts` maps them to code / cache / model tier / human. Every competitor read picks *among models* (OpenRouter, Martian, Not Diamond, RouteLLM, LiteLLM, Requesty, Ramp) or among providers (Vercel, Cloudflare, Portkey). None of their pages describes "this step should not be a model call at all". *(Absence from pages read ≠ proven absence.)*
2. **Savings are tagged by how they're known, and cache hits are checked against recorded answers.** `src/lib/shadow` replays the *same* decision engine the proxy runs, chronologically (no lookahead), and compares each cache hit with the answer the model actually gave. `src/lib/report` assigns savings to modeled / benchmarked / replayed / measured / verified *per dollar* — only the output-verified part of a task earns "replayed". Competitors either give a single headline % (Not Diamond, Requesty, OpenRouter, Martian), or publish a benchmark (LiteLLM, Mentlio, RouteLLM). The closest analog is Mentlio's modeled-vs-invoice-verified methodology (archived in `research/mentlio/`) and LiteLLM's shuffled-control benchmark; neither verifies *your* traffic before acting. Ramp lists a "Shadow models" strategy whose behavior I could not read [U] — **watch this one**.
3. **Audit-first, proxy-optional.** We ingest LangSmith, OTLP, Claude Code, Codex and OpenAI logs and produce a report without touching production. Langfuse/Phoenix hold the same traces but (from pages read) stop at cost display and evals; routers need to sit in the request path. This is a real wedge, but it's an *integration* difference, not a technical moat — anyone with those traces could build it in weeks.
4. **Pricing honesty as product.** Reports separate "modeled-only would have claimed X%" from the evidence-adjusted figure, and withhold savings if replay diverges. Given LLMRouterBench and LiteLLM's AUC≈0.52 result, a tool that is willing to say "your task isn't cacheable/downgradable" has a credibility edge. This is positioning, not tech.

## 3. Where it is only a claim

Be strict here — these are the places a skeptical buyer or competitor will poke.

1. **"Workflow decomposition" from real traces is call-site clustering, not step recovery.** `callsToWorkflowTrace` groups calls by system prompt and sets `dependsOn: []` for every step. We do **not** reconstruct the workflow graph, loops, or which calls are bundles of easy tasks. The hand-authored fixtures have graphs; ingested traffic doesn't. Not Diamond (sub-agent/compaction awareness), Ramp (turn difficulty) and OpenRouter (session stickiness) operate at a comparable or finer granularity on agent traffic. *Our granularity is no better than theirs; the taxonomy is.*
2. **The classifier is keyword rules plus two observed-stat rules — the exact family LiteLLM measured as non-predictive.** Their heuristic scorer scored AUC 0.524; fitted routing didn't beat a shuffled control (CI [−0.2,+4.8]) [V]. Our keyword rules (`classify.ts`) were built against **three hand-authored fixtures** and **synthetic sample data we generated ourselves** — which was *constructed* to contain repeats, narrow outputs and risk words, so passing it is circular. The observed-stats rules (repeat-input rate, output consistency) are more defensible than keywords because they use behavior, not wording, but they have **never been run on real traffic**. Until they beat a shuffled control on real data, the classifier is a hypothesis.
3. **"Deterministic → replace with code" is a label, not a capability.** The gateway has no code handler: a `deterministic` task is routed to a non-frontier *model* (see `engine.ts`). The savings engine models deterministic steps at $0, the proxy replay prices them at a cheap-model cost. Nothing synthesizes or verifies the replacement code. This is the thesis's headline lever and it is unbuilt.
4. **Every dollar figure in this repo is illustrative.** Tier prices are a hand-set table; model→tier is a name regex; a downgraded call is assumed to use the same token counts; the Anthropic LLM-fallback classifier has never run against the real API. The landing page's "18% / 53% evidence-backed / 26% modeled-only" are computed from *synthetic* data: they demonstrate the report's mechanics, **not** any measured saving. Do not quote them as results.
5. **The 90/9/1 split and "90% of spend never needed to happen" are the source article's claims** ([@vasuman](https://x.com/vasuman/status/2089436710257959073)), not ours and not measured by anyone in the research. Closest independent data: LLMRouterBench's best methods got up to ~4% accuracy gain or ~31.7% cost reduction at matched accuracy [S], and LiteLLM's best result was 47.5–58% savings at roughly flagship-equivalent quality on a 300-prompt chat/reasoning/code mix [V] — different tasks, different methods, not comparable to business workflows.
6. **"Local-first" is only partly true for the proxy.** The CLI and anonymizer are local; the proxy is a process you run, which is fine, but the ledger/dashboard story that Mentlio built (on-device scoring, aggregate-only upload) isn't there.
7. **Exact-match cache only.** Fine and safe (it's what Cloudflare and Helicone ship), but it's the *least* differentiating cache; Portkey (Enterprise) and LiteLLM offer semantic caches, with documented false-hit risk.
8. **Threat of the bigger shift:** several leaders now do step/session routing on agent traffic. The "they only pick a model per call" line in the earlier version of COMPETITORS.md was already stale; do not repeat it.

---

## 4. The 5 highest-leverage things to build next

Ordered by what most reduces the risk that the thesis is wrong. Effort is for one engineer. **Impact is described by what it would prove or unlock — none is a savings estimate**, because none has been measured.

### 1) Validate the classifier on real traffic against a shuffled control — *Effort: M (3–4 days) · Impact: decisive*
Run `classify` + `shadow` on real traces and publish, in LiteLLM's style: blinded/paired quality judging, 95% CIs, a cost-matched shuffled control, and the AUC of "classifier says downgradable" vs "cheap model actually matched". Reuse `casesFromCalls`, `benchmarkTask`, `replayCalls`. This is the single result that tells us whether keyword + observed-stat rules carry any signal beyond the ~0.52 AUC LiteLLM found. If they don't, the product is the measurement/verification layer, not the classifier. *Data:* the user's own Claude Code/Codex transcripts (adapters exist) test mechanics; at least one non-coding workflow trace (support/AP) is needed to test the actual thesis.

### 2) Deterministic-step extraction with verified code — *Effort: L (6–8 days) · Impact: potentially the real moat; unproven*
For tasks with high repeat rate and consistent outputs (or a small output set), synthesize a lookup/rule (table, regex, field mapping), verify it against the recorded input→output pairs and a held-out slice, and let the proxy execute it as a `code` resource with a shadow verdict. Nothing in COMPETITORS.md does this. It's also the highest-risk item: many "deterministic-looking" tasks hide judgment; the verification gate (hold-out agreement + coverage) is what keeps it safe. Start with the narrow case — exact input→output tables with a fallback on miss — before anything rule-synthesis-like.

### 3) A reproducible savings-verification kit (the "proof" product) — *Effort: M (4–5 days) · Impact: trust, differentiates against every unmeasured claim*
Package what already exists into something a skeptic can rerun: paired replay with a shuffled-control arm, CIs on savings *and* on quality agreement, separate accounting for provider-native levers (prompt-cache reads at 0.1× and batch at 50%, per Anthropic/OpenAI docs) so we never take credit for discounts the provider already gives, live-ledger → measured tier, and invoice reconciliation wired to a real provider CSV. Publish the methodology page (Mentlio-style) and a fixed benchmark harness. Competes on credibility where Requesty/Not Diamond/OpenRouter publish unmethodized numbers.

### 4) Safe semantic cache with a per-task error bound — *Effort: M (4–5 days) · Impact: fills a gap two competitors fence off*
Portkey gates semantic cache to Enterprise (0.95 cosine, ≤4 messages, ignores the system prompt); LiteLLM warns it "goes badly wrong on agentic traffic"; Cloudflare/Helicone are exact-only. vCache's idea — a user-set maximum error rate with a per-embedding learned threshold [V: arXiv 2502.03771] — fits our shadow machinery: verify near-duplicate hits against recorded answers and only enable the task if agreement clears the bound. Ship only per-task, opt-in, with the same "withhold savings if it diverges" rule. Risk: embedding dependency; keep it behind a flag until #1 shows the exact cache is already paying.

### 5) Plug into where traces and traffic already live — *Effort: S–M (3 days) · Impact: distribution, not technology*
OTLP receiver endpoint (Langfuse/Phoenix/OpenInference users point their exporter at us), a LiteLLM callback/Langfuse export reader, and a `gen_ai.*` mapper hardened against real exports. Today the adapters read files; teams with Langfuse/Phoenix/LiteLLM already have continuous traces. "Point your existing tracing at RouteWise and get a shadow report" is the cheapest possible onboarding and costs competitors nothing to ignore — which is why it's an *adoption* item, not a moat.

**Considered and deferred:** prompt compression (real lever, LLMLingua-class; crowded by coding-agent tools); batching (provider-native, mostly a recommendation); a learned router (Not Diamond/RouteLLM territory — we'd be late and the evidence says it's hard); governance/budget circuit breakers (Portal26/Cloudflare/Ramp already cover it).

---

## 5. Two-week build plan

**Premise:** items 1, 3 and 5 are mostly assembling existing modules; item 2 is the only research-grade one. Day 1 decides the shape of the rest.

**Week 1 — find out whether the classifier is real (items 1 + 3-core)**
- **D1** Get data. Anonymize the user's own Claude Code/Codex transcripts with the existing CLI; ask for (or generate from a live app) at least one non-coding workflow trace. If no business trace by end of D2, proceed with coding traces and **label every result "coding agents only"**.
- **D2** Build the evaluation harness: label each task "cheap tier sufficient?" via the paired-replay/benchmark path; add the cost-matched shuffled-control arm; add AUC + CI computation.
- **D3** First honest results on real data. Write them up whatever they say. Add provider-native accounting (cache-read 0.1×/batch 50%) so reports separate router savings from free discounts.
- **D4** Iterate the classifier only where evidence says so (e.g. tighten/relax the observed-stat thresholds); re-run against the *same* control. No tuning on the held-out slice.
- **D5** Publish `docs/methodology.md` (what is measured, tiers, controls, limits) and regenerate the README badge from real data, labelled with its tier.

**Gate at end of Week 1 (decision rule, set now):**
- Observed-stat rules beat the shuffled control with CI excluding zero → continue to item 2 and 4.
- They don't → stop investing in classification; reposition as the verification/audit layer (items 3, 5) and drop the "decomposition" claim from the README until it's earned.

**Week 2 — the lever or the distribution, depending on the gate**
- **If gate passed:** D6–D9 item 2 (exact input→output tables as a `code` resource: extraction, hold-out verification, proxy execution, shadow verdict, a test that a divergent table is withheld). D10 item 4 prototype behind a flag *only if* time remains; otherwise write up why not.
- **If gate failed:** D6–D8 item 3 completion (paired-arm CLI, invoice CSV reconciliation) and D9–D10 item 5 (OTLP receiver + Langfuse/LiteLLM export readers).
- **D10 (either way)** Rerun the full suite, regenerate samples, update `PLAN.md`, and add a "what we measured / what we didn't" section to the README so claims can't outrun evidence again.

**Not in the 2 weeks:** the Vercel deploy (needs the user's login), a shared proxy cache backend, a live run of the Anthropic classifier fallback and benchmark runners (needs API keys) — each is small but blocked on credentials, not engineering.

## 6. One-paragraph positioning that survives the evidence

*RouteWise is the layer that tells you, with receipts, which of your LLM calls didn't need to be what they are — and refuses to claim a saving until your own traffic backs it.* That claim is defensible today (the taxonomy and the evidence tiers are real and tested). "We decompose workflows and cut spend by X%" is not defensible yet — and per Section 3, saying it would put us in the same unmethodized-claim category as the competitors we're trying to differ from.
