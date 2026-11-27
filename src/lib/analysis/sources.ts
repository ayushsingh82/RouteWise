import { loadCalls } from "@/lib/ingest/load";
import { anonymizeCalls, type AnonymizationReport } from "@/lib/ingest/anonymize";
import { callsToWorkflowTrace, groupCallsByTask } from "@/lib/ingest/to-trace";
import { TRACE_SOURCES, TraceParseError, type CallRecord, type TraceSource } from "@/lib/ingest/types";
import { SAMPLE_DATASETS } from "@/lib/ingest/sample-data";
import { ingestWorkflowTrace, WorkflowIngestError } from "@/lib/workflow/ingest";
import { apInvoiceProcessingTrace } from "@/lib/workflow/fixtures/ap-invoice-processing";
import { supportTicketTriageTrace } from "@/lib/workflow/fixtures/support-ticket-triage";
import { contentModerationQueueTrace } from "@/lib/workflow/fixtures/content-moderation-queue";
import type { WorkflowTrace } from "@/lib/workflow/types";

/** Built-in hand-authored workflows (modeled tier only: there is no recorded traffic behind them). */
export const FIXTURES: Record<string, WorkflowTrace> = {
  "ap-invoice": apInvoiceProcessingTrace,
  "support-ticket-triage": supportTicketTriageTrace,
  "content-moderation-queue": contentModerationQueueTrace,
};

/** Bundled sample datasets: synthetic recorded traffic in each tool's real export format. */
export const SAMPLES = SAMPLE_DATASETS.map((d) => ({ id: d.id, label: d.label, description: d.description, format: d.format }));

export type AnalysisSource =
  | { kind: "fixture"; name: string }
  | { kind: "sample"; id: string }
  | { kind: "trace"; trace: unknown }
  | { kind: "raw"; text: string; format?: TraceSource; anonymize?: boolean; knownTerms?: string[]; fileName?: string };

/** Bad input from the caller (maps to HTTP 400), as opposed to a bug. */
export class AnalysisInputError extends Error {}

export interface ResolvedSource {
  trace: WorkflowTrace;
  label: string;
  /** Present when the trace was built from recorded calls (enables shadow replay + benchmark). */
  calls?: CallRecord[];
  stepKeys?: Record<string, string>;
  anonymization?: AnonymizationReport;
  sourceFormat?: TraceSource | "canonical";
}

export function resolveSource(src: AnalysisSource): ResolvedSource {
  switch (src.kind) {
    case "fixture": {
      const trace = FIXTURES[src.name];
      if (!trace) throw new AnalysisInputError(`Unknown fixture "${src.name}". Available: ${Object.keys(FIXTURES).join(", ")}`);
      return { trace, label: trace.name };
    }
    case "trace": {
      try {
        const trace = ingestWorkflowTrace(src.trace);
        return { trace, label: trace.name };
      } catch (err) {
        if (err instanceof WorkflowIngestError) throw new AnalysisInputError(`Invalid workflow trace: ${err.message}`);
        throw err;
      }
    }
    case "sample": {
      const d = SAMPLE_DATASETS.find((s) => s.id === src.id);
      if (!d) throw new AnalysisInputError(`Unknown sample "${src.id}". Available: ${SAMPLES.map((s) => s.id).join(", ")}`);
      return fromCalls(loadCalls(d.raw()), { anonymize: true, label: d.label });
    }
    case "raw": {
      if (src.format && !TRACE_SOURCES.includes(src.format)) throw new AnalysisInputError(`Unknown format "${src.format}". Supported: ${TRACE_SOURCES.join(", ")}`);
      try {
        return fromCalls(loadCalls(src.text, { format: src.format }), { anonymize: src.anonymize !== false, knownTerms: src.knownTerms, label: src.fileName ?? "Uploaded trace" });
      } catch (err) {
        if (err instanceof TraceParseError) throw new AnalysisInputError(err.message);
        throw err;
      }
    }
  }
}

function fromCalls(loaded: { source: TraceSource | "canonical"; calls: CallRecord[] }, o: { anonymize: boolean; knownTerms?: string[]; label: string }): ResolvedSource {
  let calls = loaded.calls;
  let anonymization: AnonymizationReport | undefined;
  if (o.anonymize) {
    const r = anonymizeCalls(calls, { knownTerms: o.knownTerms });
    calls = r.calls;
    anonymization = r.report;
  }
  const trace = callsToWorkflowTrace(calls, { name: o.label });
  return { trace, label: o.label, calls, anonymization, sourceFormat: loaded.source, stepKeys: Object.fromEntries(groupCallsByTask(calls).map((g) => [g.stepId, g.key])) };
}

/** Parses `?fixture=` / `?sample=` into a source (GET endpoints). Defaults to the first fixture. */
export function sourceFromParams(params: URLSearchParams): AnalysisSource {
  const sample = params.get("sample");
  if (sample) return { kind: "sample", id: sample };
  return { kind: "fixture", name: params.get("fixture") ?? "ap-invoice" };
}

/** Parses a POST body: `{trace}` (workflow trace JSON) or `{raw, format?, anonymize?, terms?}` (a tool's export as text). */
export function sourceFromBody(body: unknown): AnalysisSource {
  if (typeof body !== "object" || body === null) throw new AnalysisInputError('Request body must be an object with a "trace" field (or a "raw" tool export).');
  const b = body as Record<string, unknown>;
  if ("trace" in b) return { kind: "trace", trace: b.trace };
  if (typeof b.raw === "string") {
    return {
      kind: "raw",
      text: b.raw,
      format: typeof b.format === "string" ? (b.format as TraceSource) : undefined,
      anonymize: b.anonymize !== false,
      knownTerms: Array.isArray(b.terms) ? b.terms.filter((t): t is string => typeof t === "string") : undefined,
      fileName: typeof b.fileName === "string" ? b.fileName : undefined,
    };
  }
  throw new AnalysisInputError('Request body must be an object with a "trace" field (or a "raw" tool export).');
}
