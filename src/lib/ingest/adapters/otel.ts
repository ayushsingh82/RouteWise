import type { CallRecord, TraceAdapter } from "../types";
import { contentToText, inferProvider, isRec, num, parseTime, resolveTokens, splitPrompt, str, type ChatMessage, type Rec } from "../util";

/**
 * OpenTelemetry OTLP/JSON exports carrying LLM spans, in either the
 * OpenInference convention (`llm.input_messages.N.message.content`,
 * `llm.token_count.*`, `input.value`) or the OTel GenAI semantic conventions
 * (`gen_ai.request.model`, `gen_ai.usage.*`, `gen_ai.prompt.N.*`, or
 * `gen_ai.input.messages` JSON). One OTLP export per file or per JSONL line.
 */

function attrValue(v: unknown): unknown {
  if (!isRec(v)) return undefined;
  if ("stringValue" in v) return v.stringValue;
  if ("intValue" in v) return num(v.intValue);
  if ("doubleValue" in v) return num(v.doubleValue);
  if ("boolValue" in v) return v.boolValue;
  if ("arrayValue" in v && isRec(v.arrayValue) && Array.isArray(v.arrayValue.values)) return v.arrayValue.values.map(attrValue);
  return undefined;
}

function attrMap(attributes: unknown): Rec {
  const out: Rec = {};
  if (!Array.isArray(attributes)) return out;
  for (const a of attributes) if (isRec(a) && typeof a.key === "string") out[a.key] = attrValue(a.value);
  return out;
}

/** Collects `<prefix>.N.<suffix...>` flattened attributes into role/text messages. */
function indexedMessages(attrs: Rec, prefix: string, roleKey: string, contentKey: string): ChatMessage[] {
  const byIndex = new Map<number, ChatMessage>();
  for (const [key, value] of Object.entries(attrs)) {
    if (!key.startsWith(`${prefix}.`)) continue;
    const m = key.slice(prefix.length + 1).match(/^(\d+)\.(.+)$/);
    if (!m) continue;
    const idx = Number(m[1]);
    const msg = byIndex.get(idx) ?? { role: "user", text: "" };
    if (m[2] === roleKey) msg.role = String(value);
    else if (m[2] === contentKey) msg.text = String(value ?? "");
    byIndex.set(idx, msg);
  }
  return [...byIndex.entries()].sort((a, b) => a[0] - b[0]).map(([, m]) => m);
}

function jsonMessages(v: unknown): ChatMessage[] {
  if (typeof v !== "string") return [];
  try {
    const parsed = JSON.parse(v);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((m) => ({ role: isRec(m) ? (str(m.role) ?? "user") : "user", text: isRec(m) ? contentToText(m.content ?? m.parts) : String(m) }));
  } catch {
    return [];
  }
}

function isLlmSpan(attrs: Rec): boolean {
  return (
    String(attrs["openinference.span.kind"] ?? "").toUpperCase() === "LLM" ||
    "gen_ai.request.model" in attrs ||
    "llm.model_name" in attrs ||
    "gen_ai.response.model" in attrs
  );
}

function* iterSpans(record: unknown): Generator<{ span: Rec; resource: Rec }> {
  if (!isRec(record) || !Array.isArray(record.resourceSpans)) return;
  for (const rs of record.resourceSpans) {
    if (!isRec(rs)) continue;
    const resource = attrMap(isRec(rs.resource) ? rs.resource.attributes : undefined);
    const scopes = Array.isArray(rs.scopeSpans) ? rs.scopeSpans : Array.isArray(rs.instrumentationLibrarySpans) ? rs.instrumentationLibrarySpans : [];
    for (const ss of scopes) {
      if (!isRec(ss) || !Array.isArray(ss.spans)) continue;
      for (const span of ss.spans) if (isRec(span)) yield { span, resource };
    }
  }
}

export const otelAdapter: TraceAdapter = {
  source: "otel",
  detect(records) {
    return records.some((r) => isRec(r) && Array.isArray(r.resourceSpans));
  },
  parse(records) {
    const calls: CallRecord[] = [];
    for (const record of records) {
      for (const { span } of iterSpans(record)) {
        const attrs = attrMap(span.attributes);
        if (!isLlmSpan(attrs)) continue;

        const model = str(attrs["llm.model_name"]) ?? str(attrs["gen_ai.response.model"]) ?? str(attrs["gen_ai.request.model"]) ?? "unknown";

        let messages = indexedMessages(attrs, "llm.input_messages", "message.role", "message.content");
        if (messages.length === 0) messages = indexedMessages(attrs, "gen_ai.prompt", "role", "content");
        if (messages.length === 0) messages = jsonMessages(attrs["gen_ai.input.messages"]);
        if (messages.length === 0 && typeof attrs["input.value"] === "string") messages = [{ role: "user", text: attrs["input.value"] as string }];
        const { system, input } = splitPrompt(messages);

        let outMsgs = indexedMessages(attrs, "llm.output_messages", "message.role", "message.content");
        if (outMsgs.length === 0) outMsgs = indexedMessages(attrs, "gen_ai.completion", "role", "content");
        if (outMsgs.length === 0) outMsgs = jsonMessages(attrs["gen_ai.output.messages"]);
        const output = outMsgs.length > 0 ? outMsgs.map((m) => m.text).join("\n") : (str(attrs["output.value"]) ?? "");

        const tokens = resolveTokens(
          {
            input: num(attrs["llm.token_count.prompt"]) ?? num(attrs["gen_ai.usage.input_tokens"]) ?? num(attrs["gen_ai.usage.prompt_tokens"]),
            output: num(attrs["llm.token_count.completion"]) ?? num(attrs["gen_ai.usage.output_tokens"]) ?? num(attrs["gen_ai.usage.completion_tokens"]),
          },
          input,
          output,
          system,
        );

        let temperature = num(attrs["gen_ai.request.temperature"]);
        if (temperature === undefined && typeof attrs["llm.invocation_parameters"] === "string") {
          try {
            temperature = num((JSON.parse(attrs["llm.invocation_parameters"] as string) as Rec).temperature);
          } catch {
            /* ignore malformed invocation params */
          }
        }

        const start = parseTime(span.startTimeUnixNano);
        const end = parseTime(span.endTimeUnixNano);
        const provider = str(attrs["llm.provider"]) ?? str(attrs["gen_ai.provider.name"]) ?? str(attrs["gen_ai.system"]);

        calls.push({
          id: str(span.spanId) ?? `otel-${calls.length}`,
          sessionId: str(attrs["session.id"]) ?? str(attrs["gen_ai.conversation.id"]) ?? str(span.traceId) ?? "otel",
          timestamp: start,
          provider: inferProvider(model, provider),
          model,
          task: str(span.name),
          system,
          input,
          output,
          ...tokens,
          costUsd: num(attrs["llm.cost.total"]),
          latencyMs: start !== null && end !== null ? end - start : undefined,
          temperature,
          source: "otel",
        });
      }
    }
    return calls;
  },
};
