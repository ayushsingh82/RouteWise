import { contentToText, estimateTokens, isRec, num, splitPrompt, str, toChatMessages, type Rec } from "../../../src/lib/ingest/util";
import type { CachedResponse, GatewayRequest, Provider } from "../../../src/lib/gateway/types";

/**
 * Wire-format knowledge for the two APIs the proxy fronts: how to read a
 * request into the gateway's normalized shape, how to read a response (JSON or
 * SSE) back into text + usage, and how to synthesize a response from a cached
 * answer in the format the client expects.
 */

export type ApiKind = "openai-chat" | "anthropic-messages";

export function matchApi(pathname: string): ApiKind | null {
  if (/^\/v1\/chat\/completions\/?$/.test(pathname)) return "openai-chat";
  if (/^\/v1\/messages\/?$/.test(pathname)) return "anthropic-messages";
  return null;
}

export const providerOf = (api: ApiKind): Provider => (api === "openai-chat" ? "openai" : "anthropic");

export function toGatewayRequest(api: ApiKind, body: Rec, taskHeader?: string): GatewayRequest | null {
  const model = str(body.model);
  if (!model || !Array.isArray(body.messages)) return null;
  const messages = toChatMessages(body.messages);
  let system: string | undefined;
  if (api === "anthropic-messages") {
    system = typeof body.system === "string" ? body.system : body.system !== undefined ? contentToText(body.system) : undefined;
    const split = splitPrompt(messages);
    return { provider: "anthropic", model, task: taskHeader, system: system || undefined, input: split.input, temperature: num(body.temperature), usesTools: usesTools(body), stream: body.stream === true };
  }
  const split = splitPrompt(messages);
  return { provider: "openai", model, task: taskHeader, system: split.system, input: split.input, temperature: num(body.temperature), usesTools: usesTools(body), stream: body.stream === true };
}

function usesTools(body: Rec): boolean {
  if (Array.isArray(body.tools) && body.tools.length > 0) return true;
  if (Array.isArray(body.functions) && body.functions.length > 0) return true;
  const rf = body.response_format;
  if (isRec(rf) && rf.type && rf.type !== "text") return true; // structured output: a different model may not honor the schema
  return false;
}

export interface ParsedResponse {
  output: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
  /** Finished normally with plain text (no tool calls, not truncated) — safe to replay from cache. */
  complete: boolean;
  usageEstimated: boolean;
}

export function parseJsonResponse(api: ApiKind, json: Rec, fallbackModel: string, inputChars: number): ParsedResponse {
  if (api === "openai-chat") {
    const choice = Array.isArray(json.choices) && isRec(json.choices[0]) ? json.choices[0] : {};
    const msg = isRec(choice.message) ? choice.message : {};
    const output = contentToText(msg.content);
    const usage = isRec(json.usage) ? json.usage : {};
    const hasTools = Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0;
    const inTok = num(usage.prompt_tokens);
    const outTok = num(usage.completion_tokens);
    return {
      output,
      inputTokens: inTok ?? Math.ceil(inputChars / 4),
      outputTokens: outTok ?? estimateTokens(output),
      model: str(json.model) ?? fallbackModel,
      complete: choice.finish_reason === "stop" && !hasTools && output !== "",
      usageEstimated: inTok === undefined || outTok === undefined,
    };
  }
  const blocks = Array.isArray(json.content) ? json.content : [];
  const output = blocks.filter((b) => isRec(b) && b.type === "text").map((b) => str((b as Rec).text) ?? "").join("");
  const hasTools = blocks.some((b) => isRec(b) && b.type === "tool_use");
  const usage = isRec(json.usage) ? json.usage : {};
  const inTok = num(usage.input_tokens);
  const outTok = num(usage.output_tokens);
  return {
    output,
    inputTokens: (inTok ?? Math.ceil(inputChars / 4)) + (num(usage.cache_read_input_tokens) ?? 0) + (num(usage.cache_creation_input_tokens) ?? 0),
    outputTokens: outTok ?? estimateTokens(output),
    model: str(json.model) ?? fallbackModel,
    complete: json.stop_reason === "end_turn" && !hasTools && output !== "",
    usageEstimated: inTok === undefined || outTok === undefined,
  };
}

/** Incrementally consumes an SSE byte stream, collecting text + usage without altering what is forwarded. */
export class SseCollector {
  private buf = "";
  private text: string[] = [];
  private model: string | undefined;
  private inTok: number | undefined;
  private outTok: number | undefined;
  private cacheTok = 0;
  private finish: string | undefined;
  private tools = false;

  constructor(private api: ApiKind) {}

  push(chunk: string): void {
    this.buf += chunk;
    let idx: number;
    while ((idx = this.buf.indexOf("\n\n")) !== -1) {
      const frame = this.buf.slice(0, idx);
      this.buf = this.buf.slice(idx + 2);
      for (const line of frame.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "" || data === "[DONE]") continue;
        try {
          this.handle(JSON.parse(data) as Rec);
        } catch {
          /* ignore a malformed frame; never break the stream */
        }
      }
    }
  }

  private handle(ev: Rec): void {
    if (this.api === "openai-chat") {
      this.model ??= str(ev.model);
      const choice = Array.isArray(ev.choices) && isRec(ev.choices[0]) ? ev.choices[0] : undefined;
      if (choice) {
        const delta = isRec(choice.delta) ? choice.delta : {};
        if (typeof delta.content === "string") this.text.push(delta.content);
        if (Array.isArray(delta.tool_calls)) this.tools = true;
        if (typeof choice.finish_reason === "string") this.finish = choice.finish_reason;
      }
      if (isRec(ev.usage)) {
        this.inTok = num(ev.usage.prompt_tokens) ?? this.inTok;
        this.outTok = num(ev.usage.completion_tokens) ?? this.outTok;
      }
      return;
    }
    switch (ev.type) {
      case "message_start": {
        const m = isRec(ev.message) ? ev.message : {};
        this.model = str(m.model) ?? this.model;
        const u = isRec(m.usage) ? m.usage : {};
        this.inTok = num(u.input_tokens) ?? this.inTok;
        this.cacheTok = (num(u.cache_read_input_tokens) ?? 0) + (num(u.cache_creation_input_tokens) ?? 0);
        break;
      }
      case "content_block_start":
        if (isRec(ev.content_block) && ev.content_block.type === "tool_use") this.tools = true;
        break;
      case "content_block_delta":
        if (isRec(ev.delta) && typeof ev.delta.text === "string") this.text.push(ev.delta.text);
        break;
      case "message_delta":
        if (isRec(ev.delta)) this.finish = str(ev.delta.stop_reason) ?? this.finish;
        if (isRec(ev.usage)) this.outTok = num(ev.usage.output_tokens) ?? this.outTok;
        break;
    }
  }

  result(fallbackModel: string, inputChars: number): ParsedResponse {
    const output = this.text.join("");
    const ok = this.api === "openai-chat" ? this.finish === "stop" : this.finish === "end_turn";
    return {
      output,
      inputTokens: (this.inTok ?? Math.ceil(inputChars / 4)) + this.cacheTok,
      outputTokens: this.outTok ?? estimateTokens(output),
      model: this.model ?? fallbackModel,
      complete: ok && !this.tools && output !== "",
      usageEstimated: this.inTok === undefined || this.outTok === undefined,
    };
  }
}

let seq = 0;
const rid = () => `${Date.now().toString(36)}${(seq++).toString(36)}`;

/** Synthesizes a provider-format response from a cached answer. Returns the body and content type. */
export function synthesizeResponse(api: ApiKind, cached: CachedResponse, stream: boolean): { body: string; contentType: string } {
  const created = Math.floor(Date.now() / 1000);
  if (api === "openai-chat") {
    const id = `chatcmpl-rw${rid()}`;
    if (!stream) {
      return {
        contentType: "application/json",
        body: JSON.stringify({ id, object: "chat.completion", created, model: cached.model, choices: [{ index: 0, message: { role: "assistant", content: cached.output }, finish_reason: "stop" }], usage: { prompt_tokens: cached.inputTokens, completion_tokens: cached.outputTokens, total_tokens: cached.inputTokens + cached.outputTokens } }),
      };
    }
    const frame = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;
    const chunk = (delta: Rec, finish: string | null) => frame({ id, object: "chat.completion.chunk", created, model: cached.model, choices: [{ index: 0, delta, finish_reason: finish }] });
    return { contentType: "text/event-stream", body: chunk({ role: "assistant", content: "" }, null) + chunk({ content: cached.output }, null) + chunk({}, "stop") + "data: [DONE]\n\n" };
  }
  const id = `msg_rw${rid()}`;
  const usage = { input_tokens: cached.inputTokens, output_tokens: cached.outputTokens };
  if (!stream) {
    return { contentType: "application/json", body: JSON.stringify({ id, type: "message", role: "assistant", model: cached.model, content: [{ type: "text", text: cached.output }], stop_reason: "end_turn", stop_sequence: null, usage }) };
  }
  const ev = (type: string, data: Rec) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
  return {
    contentType: "text/event-stream",
    body:
      ev("message_start", { message: { id, type: "message", role: "assistant", model: cached.model, content: [], stop_reason: null, usage: { input_tokens: cached.inputTokens, output_tokens: 1 } } }) +
      ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } }) +
      ev("content_block_delta", { index: 0, delta: { type: "text_delta", text: cached.output } }) +
      ev("content_block_stop", { index: 0 }) +
      ev("message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: cached.outputTokens } }) +
      ev("message_stop", {}),
  };
}
