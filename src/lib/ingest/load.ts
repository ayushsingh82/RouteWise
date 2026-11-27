import { parseJsonOrJsonl, parseTrace, type ParseOptions } from "./index";
import type { CallRecord, TraceSource } from "./types";
import { isRec } from "./util";

/** True for a previously-saved canonical CallRecord[] (what `ingest --out` writes). */
function looksCanonical(records: unknown[]): records is CallRecord[] {
  const r = records[0];
  return isRec(r) && typeof r.sessionId === "string" && typeof r.inputTokens === "number" && typeof r.outputTokens === "number" && typeof r.model === "string" && "input" in r;
}

/** Loads calls from either a raw tool export (any supported format) or a canonical calls file. */
export function loadCalls(text: string, opts: ParseOptions = {}): { source: TraceSource | "canonical"; calls: CallRecord[] } {
  const records = parseJsonOrJsonl(text);
  if (!opts.format && looksCanonical(records)) return { source: "canonical", calls: records };
  return parseTrace(text, opts);
}
