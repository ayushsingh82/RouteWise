# routewise-proxy

A drop-in, OpenAI- and Anthropic-compatible proxy that **classifies, caches and routes** live LLM calls — with a **shadow mode** that proves the savings on your own traffic before it changes anything.

- Zero runtime dependencies (Node ≥ 18). Your API keys pass straight through to the provider.
- Speaks `POST /v1/chat/completions` (OpenAI) and `POST /v1/messages` (Anthropic), JSON and SSE streaming. Everything else is forwarded untouched.
- The ledger it writes (`--ledger`) holds routing metadata only — task id, action, models, token counts, dollars. Never prompts, completions or keys.

## Use

```bash
# 1. Shadow (default): forwards every request unchanged; records what routing WOULD have done
npx routewise-proxy --ledger ledger.jsonl --verbose

# 2. Point your existing client at it
export OPENAI_BASE_URL=http://localhost:8787/v1
export ANTHROPIC_BASE_URL=http://localhost:8787

# 3. Look at what enforcing would save (live, with output-verified cache hits)
curl localhost:8787/__routewise/stats

# 4. Enforce — only on tasks that passed shadow
npx routewise-proxy --mode enforce --shadow-trace langsmith-export.json     # replay a recorded trace first
npx routewise-proxy --mode enforce --approve-from ledger.jsonl              # or approve from a live shadow run
```

`--shadow-trace` accepts raw exports from LangSmith, OpenTelemetry/OpenInference, Claude Code, Codex and OpenAI logs. It replays the policy over those recorded calls (also warming the cache and classifier), then enforces **only the tasks whose replayed outputs matched what the model actually said**. Enforce mode refuses to start without shadow evidence unless you pass `--approve-all`.

## What it does to a request

| Task looks like | Action |
| --- | --- |
| Identical input seen before, same output every time (observed) | Serve the stored response locally (JSON or SSE), zero upstream call |
| Bounded categorization / extraction / narrow output | Rewrite `model` to the next cheaper tier |
| Needs judgment, high stakes, tools/structured output, temperature > 0.2 (for caching), unknown or cold task | Pass through unchanged |

Tasks are identified by their system prompt (or an explicit `x-routewise-task` header). A task isn't acted on until 8 calls have been observed. `x-routewise-bypass: 1` skips routing for one request. Responses carry `x-routewise-action` / `x-routewise-task` headers.

## Options

`--port` (8787) · `--mode shadow|enforce` · `--shadow-trace <file>` · `--approve-from <ledger>` · `--approve-all` · `--ledger <file>` · `--openai-upstream <url>` · `--anthropic-upstream <url>` · `--verbose`

Programmatic use: `import { createProxy } from "routewise-proxy"`.

## Honest limits

- A downgrade changes the model, so quality is a real risk until proven: shadow can verify cache hits against recorded answers, and downgrades only where a cheaper tier already answered the same input (an A/B or eval run). Otherwise run `routewise benchmark` first.
- Pricing is an illustrative tier table; set your contract prices in the policy before quoting dollars.
- Multi-instance deployments need a shared cache; this version keeps it in process memory (bounded, TTL'd).
