# Mentlio — Routing in the Fable Era: Frontier Quality Without the Frontier Tax (archived)

Source: mentlio.com blog ("Mentlio Route benchmark" / referenced sitewide as the "Terminal-Bench 2.1 whitepaper"), by Ahmet Demirbas, July 2026, 7 min read. Archived as competitor research for RouteWise — see [`../../COMPETITORS.md`](../../COMPETITORS.md).

> On the same SWE-Bench Pro replay, Mentlio Route kept 96.32% route sufficiency and reduced average model cost by 20.66% compared with Always Fable.

## Why Fable changes the baseline

Fable 5 raises the ceiling on coding performance, but it also raises the cost of sending every task to the strongest model. In this replay, **Always Fable** scored **80.4** at a relative cost of **10.00**. **Always Opus** cut that cost in half, but its score fell to **69.8**.

Routing is useful in the space between those two defaults: reserve Fable for work that needs it, use a less expensive tier when the expected result remains strong.

## Evaluation contract

Every policy is replayed against the same recorded model outcomes. For each task, the router selects a model tier and receives that tier's recorded result and cost. Model traces do not change between policies, so the comparison isolates the routing decision.

- **Sufficiency** — whether the chosen tier was strong enough for the task.
- **Actual score** — the result produced by the selected tier.
- **Cost** — indexed to Always Fable at 10.00, so savings are comparable without tying the result to one vendor contract.

## Results

| Policy | Sufficient | Cost | Score |
|---|---|---|---|
| Always Fable | 100.00% | 10.00 | 80.4 |
| Mentlio Route | 96.32% | 7.93 | 78.4 |
| NadirClaw (tuned) | 91.32% | 7.62 | 74.6 |
| Always Opus | 86.84% | 5.00 | 69.8 |

Mentlio Route scored 78.4 at a relative cost of 7.93 — 2.0 points behind Always Fable while reducing cost by **20.66%**. Always Opus was cheaper but gave up 10.6 points of score.

## Router comparison

The tuned **NadirClaw** configuration reduced cost by 23.79% — slightly more than Mentlio. At that operating point it reached 91.32% sufficiency and a 74.6 score. Mentlio reached 96.32% sufficiency and a 78.4 score: the extra quality cost 3.13 percentage points of savings.

Practical routing tradeoff: the lowest bill is not automatically the best result. A production policy needs a quality floor, then should find the lowest cost that stays above it.

## Validity and limits

This is a **replay benchmark, not a live production trial**. It compares routing policies on the same model results and task set. Absolute savings also depend on the customer's model prices and token mix. The result covers software-engineering tasks from one benchmark family. Before automatic routing, Mentlio recommends evaluating the same policy in **shadow mode** on the customer's own traffic and quality requirements.

## Mentlio's impact (their framing)

Mentlio turns model choice into a policy that can be measured before it is enforced. Teams can set a quality floor, compare the routed result with an always-frontier baseline, and review when a stronger model was selected. In this replay, that control preserved most of Fable's result while removing 20.66% of its modeled cost — repeatable on private workloads without exporting source code or raw prompts.

> Test the policy on your workload. Mentlio starts in shadow mode and measures quality and cost against your existing model traces.
