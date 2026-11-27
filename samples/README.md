# Sample trace data

Fully **synthetic** — every person, email, key, phone number and path was generated — but deliberately seeded with the kinds of PII real traces carry, so the anonymizer has work to do. One support-ops scenario (six tasks: triage, sentiment, KB answers, invoice extraction, reply drafting, refund-risk review, including a cheaper-model A/B on triage) and one coding scenario, each rendered in a tool's real export format:

| File | Format |
| --- | --- |
| `langsmith-support-ops.json` | LangSmith run export (LangChain-serialized messages) |
| `otel-support-ops.json` | OTLP/JSON: OpenAI calls as OTel GenAI semconv, Anthropic calls as OpenInference |
| `openai-support-ops.jsonl` | OpenAI request/response log lines |
| `claude-code-sessions.jsonl` | Claude Code transcripts (per-block lines merged by message id, cache reads) |
| `codex-sessions.jsonl` | Codex rollout files (duplicate `token_count` events collapsed) |
| `anonymized/*.calls.json` | The canonical calls after anonymization |

Regenerate with `npm run rw -- samples` (deterministic). Try them: `npm run rw -- report samples/langsmith-support-ops.json --anonymize --pdf report.pdf`.
