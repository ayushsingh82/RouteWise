import type { CallRecord, TraceAdapter } from "../types";
import { contentToText, isRec, num, parseTime, str, estimateTokens, type Rec } from "../util";

/**
 * Claude Code session transcripts (`~/.claude/projects/<project>/<session>.jsonl`).
 * One model call = one assistant `message.id`. Claude Code writes a separate
 * JSONL line per content block of the same message, so lines are merged by
 * message id (usage taken from the final line, which carries the settled
 * output_tokens). Input tokens include prompt-cache reads/writes; cache reads
 * are tracked separately so cost can apply the cached-input discount.
 */

const MAX_INPUT_CHARS = 4000;

function userLineText(line: Rec): string {
  const msg = isRec(line.message) ? line.message : {};
  return contentToText(msg.content).slice(0, MAX_INPUT_CHARS);
}

interface Pending {
  id: string;
  line: Rec;
  input: string;
  text: string[];
  tools: string[];
  usage: Rec;
}

export const claudeCodeAdapter: TraceAdapter = {
  source: "claude-code",
  detect(records) {
    return records.some((r) => isRec(r) && (r.type === "assistant" || r.type === "user") && isRec(r.message) && typeof r.sessionId === "string");
  },
  parse(records) {
    const calls: CallRecord[] = [];
    const pending = new Map<string, Pending>();
    const order: string[] = [];
    let lastInput = "";

    for (const raw of records) {
      if (!isRec(raw) || !isRec(raw.message)) continue;
      if (raw.type === "user") {
        const t = userLineText(raw);
        if (t) lastInput = t;
        continue;
      }
      if (raw.type !== "assistant" || raw.isApiErrorMessage === true) continue;
      const msg = raw.message;
      const model = str(msg.model);
      if (!model || model.startsWith("<")) continue; // "<synthetic>" client-side placeholders
      const mid = str(msg.id) ?? str(raw.uuid) ?? `cc-${order.length}`;

      let p = pending.get(mid);
      if (!p) {
        p = { id: mid, line: raw, input: lastInput, text: [], tools: [], usage: {} };
        pending.set(mid, p);
        order.push(mid);
      }
      const blocks = Array.isArray(msg.content) ? msg.content : [];
      for (const b of blocks) {
        if (!isRec(b)) continue;
        if (b.type === "text" && typeof b.text === "string") p.text.push(b.text);
        else if (b.type === "tool_use" && typeof b.name === "string") p.tools.push(b.name);
      }
      if (isRec(msg.usage)) p.usage = { ...p.usage, ...msg.usage };
    }

    for (const mid of order) {
      const p = pending.get(mid)!;
      const msg = p.line.message as Rec;
      const model = str(msg.model)!;
      const u = p.usage;
      const cacheRead = num(u.cache_read_input_tokens) ?? 0;
      const cacheWrite = num(u.cache_creation_input_tokens) ?? 0;
      const freshIn = num(u.input_tokens);
      const outTok = num(u.output_tokens);
      const output = [...p.text, ...p.tools.map((t) => `[tool_use:${t}]`)].join("\n");
      const estimated = freshIn === undefined || outTok === undefined;
      const sidechain = p.line.isSidechain === true;
      const kind = p.tools.length > 0 ? `tool:${p.tools[0]}` : "reply";

      calls.push({
        id: mid,
        sessionId: str(p.line.sessionId) ?? "claude-code",
        timestamp: parseTime(p.line.timestamp),
        provider: "anthropic",
        model,
        task: `${sidechain ? "subagent" : "claude-code"}:${kind}`,
        input: p.input,
        output,
        inputTokens: (freshIn ?? estimateTokens(p.input)) + cacheRead + cacheWrite,
        outputTokens: outTok ?? estimateTokens(output),
        cachedInputTokens: cacheRead || undefined,
        costUsd: num(p.line.costUSD),
        tools: p.tools.length > 0 ? p.tools : undefined,
        tokensEstimated: estimated || undefined,
        source: "claude-code",
      });
    }
    return calls;
  },
};
