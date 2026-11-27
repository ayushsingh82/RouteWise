/**
 * Canonical, source-agnostic record of one LLM call. Every trace adapter
 * (LangSmith, OpenTelemetry/OpenInference, Claude Code, Codex, OpenAI logs)
 * normalizes into this shape; everything downstream — anonymization,
 * aggregation into a WorkflowTrace, shadow replay, benchmarking — only ever
 * sees CallRecords.
 */

export type TraceSource = "langsmith" | "otel" | "claude-code" | "codex" | "openai";

export const TRACE_SOURCES: TraceSource[] = ["langsmith", "otel", "claude-code", "codex", "openai"];

export interface CallRecord {
  id: string;
  /** Groups calls from one agent run / session / conversation. */
  sessionId: string;
  /** ms since epoch, or null if the source didn't record it. */
  timestamp: number | null;
  provider: "openai" | "anthropic" | "other";
  model: string;
  /** Span / run / turn name when the source has one (e.g. a LangChain run name). Used to group calls into tasks. */
  task?: string;
  /** System / developer instructions, if captured. */
  system?: string;
  /** The (non-system) input the model saw. For multi-message prompts, role-tagged. */
  input: string;
  output: string;
  inputTokens: number;
  outputTokens: number;
  /** Subset of inputTokens served from the provider's prompt cache (billed at a discount). */
  cachedInputTokens?: number;
  /** Cost as reported by the source, when it reports one. Otherwise computed from the pricing table. */
  costUsd?: number;
  latencyMs?: number;
  temperature?: number;
  /** Names of tools the model invoked in this call, if any. */
  tools?: string[];
  /** True if token counts were estimated (chars/4) because the source didn't report them. */
  tokensEstimated?: boolean;
  source: TraceSource;
}

export class TraceParseError extends Error {}

export interface TraceAdapter {
  source: TraceSource;
  /** Cheap structural sniff of the already-parsed records. */
  detect(records: unknown[]): boolean;
  parse(records: unknown[]): CallRecord[];
}
