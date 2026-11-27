import type { CallRecord, TraceAdapter } from "../types";
import { contentToText, estimateTokens, isRec, num, parseTime, str, type Rec } from "../util";

/**
 * Codex CLI rollout transcripts (`~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`).
 * Lines are `{timestamp, type, payload}`. A model request ends where a
 * `token_count` event reports `last_token_usage`; the assistant text and tool
 * calls accumulated since the previous request are that request's output, and
 * the latest user message / tool output is its input. Duplicate token_count
 * events (Codex re-emits the same totals) are collapsed by cumulative total.
 */

const MAX_INPUT_CHARS = 4000;

export const codexAdapter: TraceAdapter = {
  source: "codex",
  detect(records) {
    return records.some((r) => isRec(r) && (r.type === "session_meta" || r.type === "response_item" || r.type === "turn_context" || r.type === "event_msg"));
  },
  parse(records) {
    const calls: CallRecord[] = [];
    let sessionId = "codex";
    let system: string | undefined;
    let model = "unknown";
    let lastInput = "";
    let out: string[] = [];
    let tools: string[] = [];
    let lastTotal = -1;
    let lastTime: number | null = null;

    for (const raw of records) {
      if (!isRec(raw)) continue;
      const payload: Rec = isRec(raw.payload) ? raw.payload : raw;
      const t = parseTime(raw.timestamp);
      if (t !== null) lastTime = t;

      switch (raw.type) {
        case "session_meta":
          sessionId = str(payload.id) ?? sessionId;
          system = str(payload.instructions) ?? system;
          break;
        case "turn_context":
          model = str(payload.model) ?? model;
          break;
        case "response_item": {
          const kind = payload.type;
          if (kind === "message") {
            const text = contentToText(payload.content);
            if (payload.role === "user") lastInput = text.slice(0, MAX_INPUT_CHARS);
            else if (payload.role === "assistant" && text) out.push(text);
          } else if (kind === "function_call" || kind === "custom_tool_call" || kind === "local_shell_call") {
            const name = str(payload.name) ?? "shell";
            tools.push(name);
            out.push(`[tool_use:${name}]`);
          } else if (kind === "function_call_output" || kind === "custom_tool_call_output") {
            const o = payload.output;
            lastInput = `[tool_result] ${typeof o === "string" ? o : contentToText(o)}`.slice(0, MAX_INPUT_CHARS);
          }
          break;
        }
        case "event_msg": {
          if (payload.type !== "token_count" || !isRec(payload.info)) break;
          const info = payload.info;
          const total = isRec(info.total_token_usage) ? (num(info.total_token_usage.total_tokens) ?? -1) : -1;
          const last = isRec(info.last_token_usage) ? info.last_token_usage : undefined;
          if (!last || (total !== -1 && total === lastTotal)) break;
          lastTotal = total;
          const cached = num(last.cached_input_tokens) ?? 0;
          const output = out.join("\n");
          const outTok = (num(last.output_tokens) ?? 0) + (num(last.reasoning_output_tokens) ?? 0);
          calls.push({
            id: `${sessionId}-${calls.length}`,
            sessionId,
            timestamp: lastTime,
            provider: "openai",
            model,
            task: tools.length > 0 ? `codex:tool:${tools[0]}` : "codex:reply",
            system,
            input: lastInput,
            output,
            inputTokens: num(last.input_tokens) ?? estimateTokens(lastInput),
            outputTokens: outTok || estimateTokens(output),
            cachedInputTokens: cached || undefined,
            tools: tools.length > 0 ? tools : undefined,
            source: "codex",
          });
          out = [];
          tools = [];
          break;
        }
      }
    }
    return calls;
  },
};
