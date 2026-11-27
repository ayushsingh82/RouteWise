import { TraceParseError, type CallRecord } from "./types";

export type Json = unknown;
export type Rec = Record<string, unknown>;

export function isRec(v: unknown): v is Rec {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function str(v: unknown): string | undefined {
  return typeof v === "string" && v !== "" ? v : undefined;
}

export function num(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}

/** Parses a whole-file JSON document (object or array) or JSON Lines into a flat list of records. */
export function parseJsonOrJsonl(text: string): unknown[] {
  const trimmed = text.trim();
  if (trimmed === "") throw new TraceParseError("Trace file is empty.");
  try {
    const whole = JSON.parse(trimmed);
    return Array.isArray(whole) ? whole : [whole];
  } catch {
    // fall through to JSONL
  }
  const out: unknown[] = [];
  const lines = trimmed.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === "") continue;
    try {
      out.push(JSON.parse(line));
    } catch (err) {
      throw new TraceParseError(`Line ${i + 1} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return out;
}

/** Flattens the many shapes a message `content` field takes (string, block array, LangChain kwargs) to plain text. */
export function contentToText(content: unknown): string {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map(contentToText).filter(Boolean).join("\n");
  if (isRec(content)) {
    const type = str(content.type);
    if (type === "tool_use" || type === "function_call") return `[tool_use:${str(content.name) ?? "unknown"}]`;
    if (type === "tool_result") return `[tool_result] ${contentToText(content.content ?? content.output)}`.trim();
    if (type === "image" || type === "image_url" || type === "input_image") return "[image]";
    if (type === "thinking" || type === "reasoning") return "";
    if (typeof content.text === "string") return content.text;
    if (content.content !== undefined) return contentToText(content.content);
    if (content.kwargs !== undefined) return contentToText(content.kwargs);
    if (content.data !== undefined) return contentToText(content.data);
  }
  return "";
}

export interface ChatMessage {
  role: string;
  text: string;
}

const LC_ROLE: Record<string, string> = {
  SystemMessage: "system",
  HumanMessage: "user",
  AIMessage: "assistant",
  ToolMessage: "tool",
  FunctionMessage: "tool",
  human: "user",
  ai: "assistant",
  system: "system",
  tool: "tool",
  user: "user",
  assistant: "assistant",
  developer: "system",
};

/** Normalizes OpenAI-style, Anthropic-style, and LangChain-serialized messages into {role, text}. */
export function toChatMessage(raw: unknown): ChatMessage | null {
  if (!isRec(raw)) return typeof raw === "string" ? { role: "user", text: raw } : null;
  // LangChain constructor serialization: {lc:1, type:"constructor", id:[..., "HumanMessage"], kwargs:{content}}
  if (Array.isArray(raw.id) && isRec(raw.kwargs)) {
    const cls = String(raw.id[raw.id.length - 1]);
    return { role: LC_ROLE[cls] ?? "user", text: contentToText(raw.kwargs.content) };
  }
  // LangChain "dict" form: {type:"human", data:{content}}
  if (typeof raw.type === "string" && isRec(raw.data) && LC_ROLE[raw.type]) {
    return { role: LC_ROLE[raw.type], text: contentToText(raw.data.content) };
  }
  const role = str(raw.role) ?? (typeof raw.type === "string" ? LC_ROLE[raw.type] : undefined) ?? "user";
  return { role: LC_ROLE[role] ?? role, text: contentToText(raw.content ?? raw.text) };
}

export function toChatMessages(raw: unknown): ChatMessage[] {
  const flat = Array.isArray(raw) ? raw.flat(2) : raw === undefined ? [] : [raw];
  return flat.map(toChatMessage).filter((m): m is ChatMessage => m !== null);
}

/** Splits messages into the system prompt and the role-tagged remainder the model actually had to respond to. */
export function splitPrompt(messages: ChatMessage[]): { system?: string; input: string } {
  const system = messages.filter((m) => m.role === "system").map((m) => m.text).join("\n\n") || undefined;
  const rest = messages.filter((m) => m.role !== "system" && m.text !== "");
  const input = rest.length === 1 ? rest[0].text : rest.map((m) => `${m.role}: ${m.text}`).join("\n");
  return { system, input };
}

export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function inferProvider(model: string, hint?: string): CallRecord["provider"] {
  const h = `${hint ?? ""} ${model}`.toLowerCase();
  if (/anthropic|claude/.test(h)) return "anthropic";
  if (/openai|azure|gpt|\bo[134]\b|chatgpt|codex/.test(h)) return "openai";
  return "other";
}

export function parseTime(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) {
    if (v > 1e17) return Math.round(v / 1e6); // ns
    if (v > 1e14) return Math.round(v / 1e3); // µs
    if (v > 1e11) return Math.round(v); // ms
    return Math.round(v * 1000); // s
  }
  if (typeof v === "string" && v !== "") {
    if (/^\d+$/.test(v)) return parseTime(Number(v));
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

/** Small, dependency-free, deterministic string hash (FNV-1a, two lanes) -> 16 hex chars. Not cryptographic. */
export function hashString(s: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c ^ (h1 & 0xff), 0x85ebca6b) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

/** Finalizes tokens: uses reported counts when present, else estimates from text and flags it. */
export function resolveTokens(
  reported: { input?: number; output?: number },
  inputText: string,
  outputText: string,
  systemText?: string,
): { inputTokens: number; outputTokens: number; tokensEstimated?: boolean } {
  const haveIn = reported.input !== undefined;
  const haveOut = reported.output !== undefined;
  if (haveIn && haveOut) return { inputTokens: reported.input!, outputTokens: reported.output! };
  return {
    inputTokens: reported.input ?? estimateTokens(`${systemText ?? ""}${inputText}`),
    outputTokens: reported.output ?? estimateTokens(outputText),
    tokensEstimated: true,
  };
}
