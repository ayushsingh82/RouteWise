import { describe, expect, it } from "vitest";
import { detectFormat, parseTrace, TraceParseError } from "./index";
import { anonymizeCalls } from "./anonymize";
import { callsToWorkflowTrace } from "./to-trace";
import {
  SAMPLE_DATASETS,
  generateCodingCalls,
  generateSupportOpsCalls,
  renderClaudeCode,
  renderCodex,
  renderLangSmith,
  renderOpenAIBatch,
  renderOpenAILogs,
  renderOtlp,
} from "./sample-data";
import { classifyTrace } from "../workflow/classify";
import { computeTraceSavings } from "../workflow/savings";

const support = generateSupportOpsCalls();
const ccCalls = generateCodingCalls({ provider: "anthropic" });
const cxCalls = generateCodingCalls({ provider: "openai" });

describe("adapters round-trip the generator", () => {
  it("langsmith: recovers every llm run, skips chains", () => {
    const { source, calls } = parseTrace(renderLangSmith(support));
    expect(source).toBe("langsmith");
    expect(calls).toHaveLength(support.length);
    expect(calls[0]).toMatchObject({ model: support[0].model, task: support[0].task, input: support[0].input, output: support[0].output, inputTokens: support[0].inputTokens });
    expect(calls[0].system).toBe(support[0].system);
  });

  it("otel: handles both GenAI semconv and OpenInference, skips non-LLM spans", () => {
    const { source, calls } = parseTrace(renderOtlp(support));
    expect(source).toBe("otel");
    expect(calls).toHaveLength(support.length);
    const anthropic = calls.find((c) => c.provider === "anthropic")!;
    const openai = calls.find((c) => c.provider === "openai")!;
    expect(anthropic.input).toBeTruthy();
    expect(openai.input).toBeTruthy();
    expect(calls.reduce((s, c) => s + c.outputTokens, 0)).toBe(support.reduce((s, c) => s + c.outputTokens, 0));
  });

  it("openai logs: request/response pairs keep prompts; only openai-provider calls", () => {
    const { source, calls } = parseTrace(renderOpenAILogs(support));
    expect(source).toBe("openai");
    expect(calls).toHaveLength(support.filter((c) => c.provider === "openai").length);
    expect(calls[0].input).toBe(support.find((c) => c.provider === "openai")!.input);
  });

  it("openai batch: joins output to input file by custom_id", () => {
    const { input, output } = renderOpenAIBatch(support);
    const { calls } = parseTrace(output, { batchInput: input });
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((c) => c.input !== "")).toBe(true);
    const without = parseTrace(output).calls;
    expect(without.every((c) => c.input === "")).toBe(true);
  });

  it("claude-code: merges per-block lines by message id and sums cache reads into input", () => {
    const { source, calls } = parseTrace(renderClaudeCode(ccCalls));
    expect(source).toBe("claude-code");
    expect(calls).toHaveLength(ccCalls.length);
    expect(calls[0].inputTokens).toBe(ccCalls[0].inputTokens);
    expect(calls[0].outputTokens).toBe(ccCalls[0].outputTokens);
    expect(calls[0].cachedInputTokens).toBe(ccCalls[0].cachedInputTokens);
    expect(calls.some((c) => c.tools?.includes("Edit"))).toBe(true);
  });

  it("codex: one call per distinct token_count, duplicates collapsed", () => {
    const { source, calls } = parseTrace(renderCodex(cxCalls));
    expect(source).toBe("codex");
    expect(calls).toHaveLength(cxCalls.length);
    expect(calls[0].model).toBe("gpt-5-codex");
    expect(calls[0].inputTokens).toBe(cxCalls[0].inputTokens);
    expect(calls[0].system).toContain("Codex CLI");
  });

  it("every bundled sample dataset auto-detects as its declared format", () => {
    for (const d of SAMPLE_DATASETS) {
      const raw = d.raw();
      expect(detectFormat(raw), d.id).toBe(d.format);
      expect(parseTrace(raw).calls.length, d.id).toBeGreaterThan(10);
    }
  });
});

describe("parseTrace errors", () => {
  it("rejects empty, malformed and unrecognized input", () => {
    expect(() => parseTrace("")).toThrow(TraceParseError);
    expect(() => parseTrace('{"a":1}\nnot json')).toThrow(/Line 2/);
    expect(() => parseTrace('{"hello":"world"}')).toThrow(/detect/);
  });
  it("rejects a forced unknown format", () => {
    // @ts-expect-error deliberately invalid
    expect(() => parseTrace("{}", { format: "nope" })).toThrow(/Unknown format/);
  });
});

describe("anonymizer", () => {
  const text = "Mail jane.doe@acme.example or call 415-555-0134. Card 4242 4242 4242 4242, key sk-ant-abcdefghijklmnopqrstuvwx, ip 203.0.113.9, see https://acme.example/x?token=abc, file /Users/jane.cho/dev/a.ts. Hi Priya Raman, regards";

  it("redacts each class and keeps placeholders stable", () => {
    const { calls, report } = anonymizeCalls([
      { id: "1", sessionId: "s", timestamp: 1, provider: "openai", model: "m", input: text, output: "ok jane.doe@acme.example", inputTokens: 1, outputTokens: 1, source: "openai" },
    ]);
    const c = calls[0];
    expect(c.input).not.toMatch(/jane\.doe|415-555|4242 4242|sk-ant|203\.0\.113|token=abc|jane\.cho|Priya/);
    expect(c.input).toContain("<EMAIL_1>");
    expect(c.output).toContain("<EMAIL_1>"); // same value -> same placeholder
    expect(report.byCategory.CARD).toBe(1);
    expect(report.byCategory.SECRET).toBe(1);
    expect(c.id).toMatch(/^id_/);
  });

  it("does not treat non-Luhn digit runs or invalid IPs as sensitive", () => {
    const { calls } = anonymizeCalls([{ id: "1", sessionId: "s", timestamp: null, provider: "other", model: "m", input: "order 1234567890123 version 999.1.2.3", output: "", inputTokens: 1, outputTokens: 1, source: "openai" }]);
    expect(calls[0].input).toBe("order 1234567890123 version 999.1.2.3");
  });

  it("replaces known terms case-insensitively", () => {
    const { calls } = anonymizeCalls([{ id: "1", sessionId: "s", timestamp: null, provider: "other", model: "m", input: "Northwind Logistics and NORTHWIND LOGISTICS", output: "", inputTokens: 1, outputTokens: 1, source: "openai" }], { knownTerms: ["Northwind Logistics"] });
    expect(calls[0].input).toBe("<TERM_1> and <TERM_1>");
  });

  it("scrubs the whole sample dataset of its planted PII", () => {
    const { calls, report } = anonymizeCalls(support);
    const blob = calls.map((c) => `${c.input}\n${c.output}`).join("\n");
    expect(blob).not.toMatch(/@[a-z-]+\.example/);
    expect(blob).not.toMatch(/415-555-/);
    expect(blob).not.toMatch(/sk-live-/);
    expect(blob).not.toMatch(/203\.0\.113\./);
    expect(report.total).toBeGreaterThan(50);
  });
});

describe("callsToWorkflowTrace + pipeline", () => {
  const trace = callsToWorkflowTrace(support, { name: "support-ops" });
  const byId = Object.fromEntries(trace.steps.map((s) => [s.id, s]));

  it("builds one step per task with summed tokens and observed stats", () => {
    expect(trace.steps.map((s) => s.id).sort()).toEqual(["extract_invoice_fields", "draft_reply", "kb_answer", "refund_risk_review", "sentiment_urgency", "ticket_triage"].sort());
    const triageCalls = support.filter((c) => c.task === "ticket_triage");
    expect(byId.ticket_triage.observedStats!.callCount).toBe(triageCalls.length);
    expect(byId.ticket_triage.observedCost!.inputTokens).toBe(triageCalls.reduce((s, c) => s + c.inputTokens, 0));
  });

  it("splits same-named tasks that have different system prompts", () => {
    const a = { ...support[0], id: "a", task: "llm", system: "You summarize." };
    const b = { ...support[0], id: "b", task: "llm", system: "You translate." };
    expect(callsToWorkflowTrace([a, b]).steps).toHaveLength(2);
  });

  it("classifies from observed traffic: recurring KB answers cacheable, high-stakes review stays frontier", () => {
    const cls = Object.fromEntries(classifyTrace(trace).map((c) => [c.stepId, c]));
    expect(cls.kb_answer.classification).toBe("cacheable");
    expect(cls.kb_answer.signals).toContain("observed:repeat-input");
    expect(cls.refund_risk_review.classification).toBe("complex-judgment");
    expect(cls.sentiment_urgency.classification).toBe("cacheable"); // recurring inputs, identical outputs
    expect(cls.draft_reply.classification).toBe("complex-judgment");
  });

  it("feeds the existing savings pipeline and finds real savings", () => {
    const report = computeTraceSavings(trace, classifyTrace(trace));
    expect(report.totals.currentUsd).toBeGreaterThan(0);
    expect(report.totals.recommendedUsd).toBeLessThan(report.totals.currentUsd);
  });

  it("anonymization preserves repeat structure (stats unchanged for PII-free recurring tasks)", () => {
    const anon = callsToWorkflowTrace(anonymizeCalls(support).calls);
    const a = anon.steps.find((s) => s.id === "kb_answer")!.observedStats!;
    expect(a.repeatInputRate).toBeCloseTo(byId.kb_answer.observedStats!.repeatInputRate, 5);
  });
});
