# Mentlio — How Mentlio Measures Token-Saver Savings (archived)

Source: mentlio.com blog, by Ahmet Demirbas, July 2026. "Benchmark-modeled tier · independent review pending." Archived as competitor research for tokenmax — see [`../../COMPETITORS.md`](../../COMPETITORS.md).

> Every savings number on the dashboard is a modeled estimate tied to a pinned benchmark artifact. This page states exactly what each saver measures, how the estimate is computed, and what it does not claim.

## Evidence tiers: what these numbers are, and are not

Dashboard savings for Lens, Logs, Recall, and Quiet publish under the **benchmark-modeled tier**: payload and benchmark measurements from pinned upstream reproductions, applied to observed usage. They are honest estimates of avoided tokens, **not invoice-equivalent dollars**. Invoice-verified claims remain gated on a 2,416-trial paired full run and an approved adversarial review of its evidence candidate — that review is currently pending.

| Saver | Measured quantity | Ratio | Interval | Evidence |
|---|---|---|---|---|
| Lens | Retrieval payload ratio vs. grep-and-read | 0.0204 (~98% fewer) | [0.0132, 0.0484] | 2 reproductions × 1,251 queries |
| Logs | Compressed vs. original payload on pinned fixtures | 0.0128 (~98.7% fewer) | [0.0105, 0.0168] | 3 byte-verified fixtures |
| Recall | Stored in-stream excerpt vs. original (fully reversible) | 0.0612 (~93.9% fewer) | point measurement | 1 pinned CCR fixture |
| Quiet | Billed output tokens vs. baseline arm | 0.8965 (~10.3% fewer) | [0.8415, 0.9538] | 2 runs × 10 prompts × 4 reps |

Ratios are treatment/baseline payload or token quantities (lower is better). The Quiet interval is a prompt-cluster bootstrap 95% interval. Lens and Logs intervals are envelopes across every pinned baseline definition and reproduction, in place of a sampling interval the aggregate artifacts can't provide.

## Lens: retrieval payload reduction

**What was measured.** Semble's token-efficiency benchmark (pinned `MinishLab/Semble c7e52fa5`, `cl100k_base` tokenizer) over 1,251 retrieval queries: expected modeled tokens to surface the first relevant file at a 32,000-token budget cap. Lens retrieval cost **604 expected tokens/query** vs. **29,607 for grep-and-read** and **45,143 for keyword-grep-and-read**. Two independent reproductions (r13, r17) agree to four decimal places.

**How the dashboard estimates savings.** Per proven Lens search: saved input tokens = (control payload chars − Lens payload chars) / 4, priced at the model's input list rate. Provider-settlement events prove billed usage but never add modeled savings (no double counting).

**Caveats.** A retrieval-payload measurement, not an end-to-end invoice claim. The chars/4 model is approximate; input list-rate pricing overstates tokens that would have been served from prompt cache.

## Logs: build and test log compression

**What was measured.** Mentlio's log compressor replayed against pinned Headroom parity fixtures (build log, pytest output, structured JSON log). Byte-verified against cited-run invariants; current product source is byte-identical to what the run measured. Measured payload ratios: **98.3–98.9% reduction** on these fixtures (earlier fixture generations: 85–94%).

**The honest production caveat.** Upstream Headroom's own production telemetry reports a **median payload reduction of 4.8% (mean 11.3%)** across all traffic, because most tool outputs aren't huge logs. Quote the fixture range only for log-heavy workflows; expect production savings to concentrate in sessions that actually emit large build/test output. **Logs ships default-off.**

**How the dashboard estimates savings.** Per applied rewrite: (original chars − compressed chars) / 4 at input list rate. Requests where the compressor declined (source code, diffs, search results are byte-transparent by policy) count as calls with zero savings.

## Recall: reversible large-output compression

**What was measured.** The exact-recall contract on the pinned CCR fixture: stored hash equals the SHA-256 prefix of the original content, and retrieval returns the exact original bytes. The pinned fixture's in-stream excerpt is **6.1% of the original payload**. Headroom's published 70–90% CCR reduction is the *upstream's* claim about its production traffic, not a Mentlio measurement.

**How the dashboard estimates savings.** Per applied block: (original chars − compressed chars) / 4 at input list rate. Retrievals that re-expand content are separate, visible retrieval calls. Compression only occurs while the retrieval tool is verifiably connected; otherwise content passes through byte-identical. **Recall ships default-off.**

## Quiet: output-token reduction with quality preserved

**What was measured.** The upstream Caveman benchmark, reproduced end-to-end twice (runs r12, r13: 10 prompts × 4 repetitions × 5 arms, Sonnet 5 agents behind a local accounting proxy). The quiet-current instruction reduced billed output tokens to a **0.8965 ratio vs. baseline** (95% bootstrap interval [0.8415, 0.9538]) while factual completeness was preserved (+0.0125 difference, interval [−0.0042, +0.0292]).

**Why Quiet quotes tokens, not cost.** Generation-cost reduction varied from **10% to 41%** across the two runs on identical workloads — prompt-cache economics dominate the dollar outcome. The billed output-token ratio was stable across both runs, so that's the published claim.

**How the dashboard estimates savings.** On each Quiet-active turn with observed provider usage: modeled saved output tokens = observed output tokens × (1/0.8965 − 1) ≈ 11.5% of observed output, priced at output list rate. Validated against both cited runs, this floor captured only **12.7% and 2.2%** of the actually observed generation-cost delta — it deliberately understates.

## Route: model price deltas, no token claim

Route savings are computed from observed or explicitly estimated **model price deltas** between the model a request would have used and the model Mentlio selected. Routing does not claim token reduction, so the dashboard's token column for Route is always zero. Route methodology is covered in the SWE-Bench Pro / Terminal-Bench 2.1 write-ups — see [`terminal-bench-2.1-whitepaper.md`](./terminal-bench-2.1-whitepaper.md).

## Evidence artifacts and reproduction

Primary run `savers-v2-v0144r13-20260715T093218Z` (source commit `03fbe855…2139`), corroborated by runs r12 (Quiet) and r17 (Lens, Logs, Recall). The claims manifest pins SHA-256 digests of the run manifest, analysis, upstream lock, report pack, this page's source, and the evidence-binding table (`docs/token-saver-claim-evidence.json` in the Mentlio repository). Two committed scripts reproduce every number from the pinned artifacts: `quiet-ratio-accuracy.mjs` and `derive-claim-evidence.mjs` under `benchmarks/token-savers`. The derivation refuses to emit evidence when the shipping saver source drifts from the cited run's pinned inputs.
