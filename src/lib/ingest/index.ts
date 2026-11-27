import { TRACE_SOURCES, TraceParseError, type CallRecord, type TraceAdapter, type TraceSource } from "./types";
import { parseJsonOrJsonl } from "./util";
import { langsmithAdapter } from "./adapters/langsmith";
import { otelAdapter } from "./adapters/otel";
import { claudeCodeAdapter } from "./adapters/claude-code";
import { codexAdapter } from "./adapters/codex";
import { createOpenAIAdapter } from "./adapters/openai";

export * from "./types";
export { parseJsonOrJsonl } from "./util";

export interface ParseOptions {
  /** Force an adapter instead of auto-detecting. */
  format?: TraceSource;
  /** For OpenAI Batch output files: the matching batch *input* file's text, so prompts can be joined by custom_id. */
  batchInput?: string;
}

function adapters(opts: ParseOptions): TraceAdapter[] {
  const openai = createOpenAIAdapter(opts.batchInput ? parseJsonOrJsonl(opts.batchInput) : undefined);
  // Order is most-specific first: OTLP and LangSmith have unambiguous top-level markers.
  return [otelAdapter, langsmithAdapter, codexAdapter, claudeCodeAdapter, openai];
}

export function detectFormat(text: string): TraceSource | null {
  const records = parseJsonOrJsonl(text);
  return adapters({}).find((a) => a.detect(records))?.source ?? null;
}

/** Parses a raw trace export (JSON or JSONL) from any supported tool into canonical CallRecords. */
export function parseTrace(text: string, opts: ParseOptions = {}): { source: TraceSource; calls: CallRecord[] } {
  const records = parseJsonOrJsonl(text);
  const all = adapters(opts);
  let adapter: TraceAdapter | undefined;
  if (opts.format) {
    adapter = all.find((a) => a.source === opts.format);
    if (!adapter) throw new TraceParseError(`Unknown format "${opts.format}". Supported: ${TRACE_SOURCES.join(", ")}`);
  } else {
    adapter = all.find((a) => a.detect(records));
    if (!adapter) {
      throw new TraceParseError(`Could not detect the trace format. Supported: ${TRACE_SOURCES.join(", ")}. Pass the format explicitly to override.`);
    }
  }
  const calls = adapter.parse(records);
  if (calls.length === 0) {
    throw new TraceParseError(`Detected ${adapter.source} format but found no LLM calls in it.`);
  }
  return { source: adapter.source, calls };
}
