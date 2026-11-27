/** Source catalog for the dashboard's pickers. Kept in sync with src/lib/analysis/sources.ts by a test. */
export const FIXTURE_LABELS: Record<string, string> = {
  "ap-invoice": "AP Invoice Processing",
  "support-ticket-triage": "Support Ticket Triage",
  "content-moderation-queue": "Content Moderation Queue",
};

export const SAMPLE_LABELS: Record<string, string> = {
  "langsmith-support-ops": "LangSmith — support ops",
  "otel-support-ops": "OpenTelemetry — support ops",
  "openai-support-ops": "OpenAI logs — support ops",
  "claude-code-sessions": "Claude Code — coding sessions",
  "codex-sessions": "Codex — coding sessions",
};
