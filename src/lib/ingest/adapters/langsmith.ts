import type { CallRecord, TraceAdapter } from "../types";
import { inferProvider, isRec, num, parseTime, resolveTokens, splitPrompt, str, toChatMessages, contentToText, type Rec } from "../util";

/**
 * LangSmith run exports (`client.list_runs(...)` dumped as a JSON array or
 * JSONL). Only `run_type: "llm"` runs are model calls; chains/tools/retrievers
 * are skipped. Handles both LangChain-serialized messages and the raw
 * OpenAI-wrapper shape (`inputs.messages` + `outputs.choices`).
 */

function outputText(outputs: unknown): string {
  if (!isRec(outputs)) return typeof outputs === "string" ? outputs : "";
  // LangChain: {generations: [[{text, message}]]}
  if (Array.isArray(outputs.generations)) {
    const g = outputs.generations.flat(2)[0];
    if (isRec(g)) return str(g.text) ?? contentToText(isRec(g.message) ? (g.message.kwargs ?? g.message) : undefined);
  }
  // OpenAI wrapper: {choices: [{message: {content}}]}
  if (Array.isArray(outputs.choices) && isRec(outputs.choices[0])) {
    const c = outputs.choices[0];
    return contentToText(isRec(c.message) ? c.message.content : c.text);
  }
  // Anthropic wrapper: {content: [{type: "text", text}]}
  if (outputs.content !== undefined) return contentToText(outputs.content);
  if (isRec(outputs.output)) return contentToText(outputs.output);
  return str(outputs.output) ?? str(outputs.text) ?? "";
}

function modelOf(run: Rec): string {
  const extra = isRec(run.extra) ? run.extra : {};
  const meta = isRec(extra.metadata) ? extra.metadata : {};
  const inv = isRec(extra.invocation_params) ? extra.invocation_params : {};
  const inputs = isRec(run.inputs) ? run.inputs : {};
  const outputs = isRec(run.outputs) ? run.outputs : {};
  const llmOut = isRec(outputs.llm_output) ? outputs.llm_output : {};
  return (
    str(meta.ls_model_name) ?? str(inv.model) ?? str(inv.model_name) ?? str(llmOut.model_name) ?? str(outputs.model) ?? str(inputs.model) ?? "unknown"
  );
}

export const langsmithAdapter: TraceAdapter = {
  source: "langsmith",
  detect(records) {
    const r = records.find(isRec);
    return !!r && typeof r.run_type === "string" && "inputs" in r;
  },
  parse(records) {
    const calls: CallRecord[] = [];
    for (const raw of records) {
      if (!isRec(raw) || raw.run_type !== "llm") continue;
      const inputs = isRec(raw.inputs) ? raw.inputs : {};
      const outputs = isRec(raw.outputs) ? raw.outputs : {};
      const extra = isRec(raw.extra) ? raw.extra : {};
      const inv = isRec(extra.invocation_params) ? extra.invocation_params : {};
      const meta = isRec(extra.metadata) ? extra.metadata : {};
      const model = modelOf(raw);

      let messages = toChatMessages(inputs.messages);
      if (messages.length === 0 && Array.isArray(inputs.prompts)) messages = toChatMessages(inputs.prompts);
      if (messages.length === 0 && typeof inputs.input === "string") messages = toChatMessages([inputs.input]);
      const { system, input } = splitPrompt(messages);
      const output = outputText(outputs);

      const usage = isRec(outputs.usage) ? outputs.usage : isRec(isRec(outputs.llm_output) ? outputs.llm_output.token_usage : undefined) ? (outputs.llm_output as Rec).token_usage as Rec : {};
      const tokens = resolveTokens(
        {
          input: num(raw.prompt_tokens) ?? num(usage.prompt_tokens) ?? num(usage.input_tokens),
          output: num(raw.completion_tokens) ?? num(usage.completion_tokens) ?? num(usage.output_tokens),
        },
        input,
        output,
        system,
      );
      const start = parseTime(raw.start_time);
      const end = parseTime(raw.end_time);

      calls.push({
        id: str(raw.id) ?? `ls-${calls.length}`,
        sessionId: str(raw.trace_id) ?? str(raw.session_id) ?? str(raw.session_name) ?? "langsmith",
        timestamp: start,
        provider: inferProvider(model, str(meta.ls_provider)),
        model,
        task: str(raw.name),
        system,
        input,
        output,
        ...tokens,
        costUsd: num(raw.total_cost),
        latencyMs: start !== null && end !== null ? end - start : undefined,
        temperature: num(inv.temperature) ?? num(meta.ls_temperature),
        source: "langsmith",
      });
    }
    return calls;
  },
};
