import type { CallRecord, TraceAdapter } from "../types";
import { contentToText, inferProvider, isRec, num, parseTime, resolveTokens, splitPrompt, str, toChatMessages, type Rec } from "../util";

/**
 * OpenAI logs in the shapes they actually turn up in:
 *  - bare Chat Completions objects (`object: "chat.completion"`) or Responses API objects (`object: "response"`)
 *  - request/response log pairs (`{request, response}` / `{request_body, response_body}`) from proxies and eval harnesses
 *  - Batch API output lines (`{custom_id, response: {status_code, body}}`), optionally joined to the batch *input*
 *    file by custom_id so the prompt is recoverable (pass it as `batchInput`).
 * A bare completion has no prompt, so `input` is empty unless a request is attached — the report flags those.
 */

function completionText(body: Rec): { text: string; tools: string[] } {
  const tools: string[] = [];
  let text = "";
  if (Array.isArray(body.choices) && isRec(body.choices[0])) {
    const c = body.choices[0];
    const m = isRec(c.message) ? c.message : {};
    text = contentToText(m.content ?? c.text);
    if (Array.isArray(m.tool_calls)) for (const tc of m.tool_calls) if (isRec(tc) && isRec(tc.function) && typeof tc.function.name === "string") tools.push(tc.function.name);
  } else if (Array.isArray(body.output)) {
    // Responses API
    const parts: string[] = [];
    for (const item of body.output) {
      if (!isRec(item)) continue;
      if (item.type === "message") parts.push(contentToText(item.content));
      else if (item.type === "function_call" && typeof item.name === "string") tools.push(item.name);
    }
    text = parts.join("\n");
  } else if (typeof body.output_text === "string") {
    text = body.output_text;
  }
  return { text, tools };
}

function promptOf(request: Rec | undefined, body: Rec): { system?: string; input: string; temperature?: number } {
  const src = request ?? (Array.isArray(body.messages) ? body : undefined);
  if (!src) return { input: "" };
  let messages = toChatMessages(src.messages);
  if (messages.length === 0 && src.input !== undefined) {
    messages = typeof src.input === "string" ? [{ role: "user", text: src.input }] : toChatMessages(src.input);
  }
  const { system, input } = splitPrompt(messages);
  const instructions = str(src.instructions);
  return { system: system ?? instructions, input, temperature: num(src.temperature) };
}

function isCompletion(r: Rec): boolean {
  return r.object === "chat.completion" || r.object === "response" || (Array.isArray(r.choices) && isRec(r.usage));
}

export function createOpenAIAdapter(batchInput?: unknown[]): TraceAdapter {
  const batchRequests = new Map<string, Rec>();
  for (const line of batchInput ?? []) {
    if (isRec(line) && typeof line.custom_id === "string" && isRec(line.body)) batchRequests.set(line.custom_id, line.body);
  }

  return {
    source: "openai",
    detect(records) {
      return records.some((r) => {
        if (!isRec(r)) return false;
        if (isCompletion(r)) return true;
        if (isRec(r.response) && (isCompletion(r.response) || isRec(r.response.body))) return true;
        return isRec(r.response_body) && isCompletion(r.response_body);
      });
    },
    parse(records) {
      const calls: CallRecord[] = [];
      for (const raw of records) {
        if (!isRec(raw)) continue;
        let body: Rec | undefined;
        let request: Rec | undefined;
        let id = str(raw.custom_id) ?? str(raw.id);

        if (isCompletion(raw)) body = raw;
        else if (isRec(raw.response) && isRec(raw.response.body)) {
          // Batch output line
          if (raw.error || (num(raw.response.status_code) ?? 200) >= 400) continue;
          body = raw.response.body;
          request = (id ? batchRequests.get(id) : undefined) ?? (isRec(raw.request) ? (isRec(raw.request.body) ? raw.request.body : raw.request) : undefined);
        } else if (isRec(raw.response) && isCompletion(raw.response)) {
          body = raw.response;
          request = isRec(raw.request) ? raw.request : undefined;
        } else if (isRec(raw.response_body)) {
          body = raw.response_body;
          request = isRec(raw.request_body) ? raw.request_body : undefined;
        }
        if (!body) continue;

        const { text, tools } = completionText(body);
        const { system, input, temperature } = promptOf(request, body);
        const model = str(body.model) ?? str(request?.model) ?? "unknown";
        const usage = isRec(body.usage) ? body.usage : {};
        const details = isRec(usage.prompt_tokens_details) ? usage.prompt_tokens_details : isRec(usage.input_tokens_details) ? usage.input_tokens_details : {};
        const tokens = resolveTokens(
          { input: num(usage.prompt_tokens) ?? num(usage.input_tokens), output: num(usage.completion_tokens) ?? num(usage.output_tokens) },
          input,
          text,
          system,
        );
        id = str(body.id) ?? id ?? `oa-${calls.length}`;
        calls.push({
          id,
          sessionId: str(raw.session_id) ?? str(raw.user) ?? str(body.user) ?? str(raw.conversation_id) ?? "openai",
          timestamp: parseTime(body.created ?? body.created_at ?? raw.created_at ?? raw.timestamp),
          provider: inferProvider(model, "openai"),
          model,
          task: str(raw.task) ?? str(raw.name) ?? str(request?.metadata && isRec(request.metadata) ? request.metadata.task : undefined),
          system,
          input,
          output: text,
          ...tokens,
          cachedInputTokens: num(details.cached_tokens),
          latencyMs: num(raw.latency_ms),
          temperature,
          tools: tools.length > 0 ? tools : undefined,
          source: "openai",
        });
      }
      return calls;
    },
  };
}

export const openaiAdapter = createOpenAIAdapter();
