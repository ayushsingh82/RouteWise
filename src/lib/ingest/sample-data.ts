import type { CallRecord } from "./types";
import { estimateTokens } from "./util";

/**
 * Deterministic, realistic sample traffic — fully synthetic (every person,
 * address, key and path below is invented) but deliberately seeded with the
 * kind of PII real traces carry, so the anonymizer has something to find.
 *
 * Two scenarios, each rendered into the raw export formats real tools emit:
 *  - support-ops  : a B2B SaaS support pipeline (triage, sentiment, KB answers,
 *                   invoice extraction, reply drafting, refund-risk review)
 *                   -> LangSmith runs, OTLP/OpenInference spans, OpenAI logs
 *  - coding       : agentic coding sessions -> Claude Code and Codex JSONL
 *
 * The generator is the single source of truth: the adapters' tests render
 * canonical calls into each raw format and assert the adapter recovers them.
 */

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T,>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
const jitter = (r: () => number, base: number, pct = 0.15) => Math.max(1, Math.round(base * (1 + (r() * 2 - 1) * pct)));

const FIRST = ["Priya", "Marcus", "Elena", "Tomás", "Hannah", "Wei", "Olu", "Sofia", "Daniel", "Aisha", "Lukas", "Mei"];
const LAST = ["Raman", "Whitfield", "Castellano", "Okafor", "Lindqvist", "Zhang", "Moreau", "Haddad", "Brennan", "Kovac"];
const COMPANIES = ["Northwind Logistics", "Brightleaf Dental", "Kestrel Analytics", "Harbor & Pine Co", "Lumen Robotics", "Tallgrass Foods"];
const DOMAINS = ["northwind-logistics.example", "brightleafdental.example", "kestrel-analytics.example", "harborpine.example", "lumenrobotics.example"];

const SYSTEMS = {
  ticket_triage:
    'You are a support triage assistant for a B2B SaaS billing product. Classify each customer ticket into exactly one category (billing, bug, how_to, account_access, feature_request) and a priority (low, normal, high). Respond with JSON only: {"category": "...", "priority": "..."}.',
  sentiment_urgency:
    'Rate the customer\'s sentiment (positive, neutral, negative) and urgency (low, normal, high) from their message. Respond with JSON only: {"sentiment": "...", "urgency": "..."}.',
  kb_answer:
    "Answer the customer's question using only the help-center guidance below. Be concise and accurate; if the guidance does not cover it, say a human agent will follow up.",
  extract_invoice_fields:
    'Extract the vendor name, invoice number, total amount and due date from the invoice text. Respond with JSON only: {"vendor": "...", "invoice_number": "...", "total": 0, "due_date": "YYYY-MM-DD"}.',
  draft_reply:
    "Draft a friendly, accurate reply to the customer's ticket on behalf of the support team. Acknowledge their situation, explain next steps, and keep it under 180 words.",
  refund_risk_review:
    "Assess whether this refund request shows signs of fraud or unusual account activity, and explain why. Weigh the account history against the request; flag anything that warrants a human review.",
} as const;

type TaskName = keyof typeof SYSTEMS;

// Recurring, PII-free tickets (automated forms, common questions) — what makes real triage traffic cacheable.
const RECURRING_TICKETS: { text: string; category: string; priority: string; kb?: string }[] = [
  { text: "How do I download my invoices as PDF?", category: "how_to", priority: "low", kb: "kb-invoices-pdf" },
  { text: "How do I change the billing email on my account?", category: "how_to", priority: "low", kb: "kb-billing-email" },
  { text: "Where can I find my API key?", category: "how_to", priority: "low", kb: "kb-api-key" },
  { text: "I can't log in — the password reset email never arrives.", category: "account_access", priority: "high", kb: "kb-password-reset" },
  { text: "Can you add a dark mode to the dashboard?", category: "feature_request", priority: "low" },
  { text: "How do I add a teammate to our workspace?", category: "how_to", priority: "low", kb: "kb-invite-teammate" },
  { text: "Is there a way to export all customers to CSV?", category: "how_to", priority: "low", kb: "kb-export-csv" },
  { text: "Two-factor code is not accepted, please help.", category: "account_access", priority: "high", kb: "kb-2fa" },
];

const KB_ANSWERS: Record<string, string> = {
  "kb-invoices-pdf": "You can download any invoice as a PDF from Billing → Invoices. Open the invoice and choose “Download PDF”. Bulk export is available from the same page via “Export all”.",
  "kb-billing-email": "Go to Settings → Billing → Contacts and edit the billing email. The change applies to the next invoice; past invoices keep the original address.",
  "kb-api-key": "API keys live under Settings → Developers → API keys. Keys are shown once when created; if you've lost one, create a new key and revoke the old one.",
  "kb-password-reset": "Password reset emails can take up to 10 minutes and sometimes land in spam. If nothing arrives, request another from the login page; a human agent will follow up if it still fails.",
  "kb-invite-teammate": "Open Settings → Team → Invite member, enter their email and choose a role. They'll receive an invitation link valid for 7 days.",
  "kb-export-csv": "Go to Customers → Export and pick CSV. Exports over 50,000 rows are emailed as a download link.",
  "kb-2fa": "Check that your device clock is set to automatic time — codes fail when the clock drifts. If it still fails, use a recovery code or a human agent will follow up to reset 2FA.",
};

interface Ticket {
  text: string;
  category: string;
  priority: string;
  sentiment: string;
  urgency: string;
  kb?: string;
  refund?: boolean;
  invoice?: boolean;
  email?: string;
  name: string;
  company: string;
}

function makeTicket(r: () => number): Ticket {
  const name = `${pick(r, FIRST)} ${pick(r, LAST)}`;
  const company = pick(r, COMPANIES);
  const email = `${name.split(" ")[0].toLowerCase()}.${name.split(" ")[1].toLowerCase()}@${pick(r, DOMAINS)}`;
  const roll = r();

  if (roll < 0.5) {
    const t = pick(r, RECURRING_TICKETS);
    return {
      text: t.text,
      category: t.category,
      priority: t.priority,
      sentiment: t.priority === "high" ? "negative" : "neutral",
      urgency: t.priority,
      kb: t.kb,
      name,
      company,
    };
  }
  if (roll < 0.72) {
    const invNo = `INV-${2026}-${String(1000 + Math.floor(r() * 8999))}`;
    const amount = (200 + Math.floor(r() * 9000) + 0.5).toFixed(2);
    const refund = r() < 0.4;
    return {
      text: `Hi ${name}'s team here from ${company}. We were charged twice on ${invNo} (total $${amount}). ${refund ? "Please refund the duplicate charge to the card ending 4242 — my number is 415-555-0" + String(100 + Math.floor(r() * 899)) + "." : "Can you confirm which charge is correct?"} You can reach me at ${email}.`,
      category: "billing",
      priority: refund ? "high" : "normal",
      sentiment: "negative",
      urgency: "high",
      refund,
      invoice: true,
      email,
      name,
      company,
    };
  }
  if (roll < 0.9) {
    const page = pick(r, ["the reports page", "invoice export", "the usage chart", "webhook settings"]);
    return {
      text: `Hello, ${page} has been throwing an error since this morning (request id req_${Math.floor(r() * 1e9).toString(36)}, from IP 203.0.113.${Math.floor(r() * 250)}). Regards,\n${name}`,
      category: "bug",
      priority: pick(r, ["normal", "high"]),
      sentiment: "negative",
      urgency: "normal",
      name,
      company,
      email,
    };
  }
  return {
    text: `My name is ${name} (${email}). I pasted our key sk-live-${Math.floor(r() * 1e15).toString(36)}${Math.floor(r() * 1e15).toString(36)}abcdef by mistake in a public channel — what should I do?`,
    category: "account_access",
    priority: "high",
    sentiment: "negative",
    urgency: "high",
    name,
    company,
    email,
  };
}

export interface SampleOptions {
  seed?: number;
  tickets?: number;
  startMs?: number;
}

/** Support-ops scenario as canonical CallRecords (provider/source stamped for the OpenAI/LangSmith/OTel renderers). */
export function generateSupportOpsCalls(opts: SampleOptions = {}): CallRecord[] {
  const r = rng(opts.seed ?? 42);
  const n = opts.tickets ?? 90;
  let t = opts.startMs ?? Date.UTC(2026, 10, 3, 14, 0, 0);
  const calls: CallRecord[] = [];

  const add = (sessionId: string, task: TaskName, model: string, input: string, output: string, extra: Partial<CallRecord> = {}) => {
    const system = SYSTEMS[task];
    const provider = model.startsWith("claude") ? "anthropic" : "openai";
    const latency = jitter(r, task === "draft_reply" || task === "refund_risk_review" ? 4200 : 900, 0.3);
    t += jitter(r, 2500, 0.6);
    calls.push({
      id: `call_${calls.length.toString().padStart(4, "0")}`,
      sessionId,
      timestamp: t,
      provider,
      model,
      task,
      system,
      input,
      output,
      inputTokens: jitter(r, estimateTokens(system + input)),
      outputTokens: jitter(r, estimateTokens(output)),
      latencyMs: latency,
      temperature: 0,
      source: "openai",
      ...extra,
    });
  };

  for (let i = 0; i < n; i++) {
    const tk = makeTicket(r);
    const session = `ticket-${(7000 + i).toString()}`;

    const triageOut = JSON.stringify({ category: tk.category, priority: tk.priority });
    add(session, "ticket_triage", "gpt-4o", tk.text, triageOut);
    // A/B: a slice of triage traffic was also replayed on gpt-4o-mini (the team's own cheaper-model eval).
    if (r() < 0.13) {
      const disagree = r() < 0.12;
      const miniOut = JSON.stringify({ category: tk.category, priority: disagree ? (tk.priority === "high" ? "normal" : "high") : tk.priority });
      add(`ab-eval-${i}`, "ticket_triage", "gpt-4o-mini", tk.text, miniOut);
    }

    add(session, "sentiment_urgency", "gpt-4o", tk.text, JSON.stringify({ sentiment: tk.sentiment, urgency: tk.urgency }));

    if (tk.kb) {
      add(session, "kb_answer", "claude-sonnet-5-5", `Question: ${tk.text}\nGuidance id: ${tk.kb}`, KB_ANSWERS[tk.kb]);
    } else {
      const reply = `Hi ${tk.name.split(" ")[0]},\n\nThanks for reaching out, and sorry for the trouble${tk.category === "bug" ? " — we're looking into the error now and will update you within the hour" : ""}. ${
        tk.invoice ? "We've reviewed the invoice and will confirm the correct charge shortly." : "A member of our team will follow up with next steps shortly."
      }\n\nBest,\nSupport Team`;
      add(session, "draft_reply", "claude-opus-5-5", `Ticket from ${tk.name} at ${tk.company}:\n${tk.text}`, reply.repeat(r() < 0.5 ? 1 : 2));
    }

    if (tk.invoice && r() < 0.7) {
      const amount = Number((200 + r() * 9000).toFixed(2));
      const invoiceText = `INVOICE ${tk.company}\nInvoice No: INV-2026-${1000 + Math.floor(r() * 8999)}\nBill to: ${tk.name}, ${tk.email}\nTotal due: $${amount}\nDue date: 2026-12-${String(1 + Math.floor(r() * 27)).padStart(2, "0")}`;
      add(session, "extract_invoice_fields", "gpt-4o", invoiceText, JSON.stringify({ vendor: tk.company, invoice_number: "INV-2026", total: amount, due_date: "2026-12-15" }));
    }
    if (tk.refund) {
      add(
        session,
        "refund_risk_review",
        "claude-opus-5-5",
        `Refund request for ${tk.email}: duplicate charge. Account age 14 months, 3 prior refunds, last login from IP 198.51.100.${Math.floor(r() * 250)}.`,
        `The request is consistent with a genuine duplicate charge: account is established, prior refunds were small and resolved, and login geography is stable. Recommend approving without escalation; no fraud indicators found. Confidence is moderate because only 3 prior refunds are on record.`,
      );
    }
  }
  return calls;
}

// ---------- coding sessions (Claude Code / Codex) ----------

const CC_PATHS = ["/Users/jane.cho/dev/billing-api/src/invoices/export.ts", "/Users/jane.cho/dev/billing-api/src/webhooks/retry.ts", "/Users/jane.cho/dev/billing-api/test/export.test.ts"];

export interface CodingSample {
  calls: CallRecord[];
}

/** One agentic bug-fix session per seed: read files, plan, edit, run tests, commit. */
export function generateCodingCalls(opts: { seed?: number; sessions?: number; provider: "anthropic" | "openai" }): CallRecord[] {
  const r = rng(opts.seed ?? 7);
  const sessions = opts.sessions ?? 3;
  const model = opts.provider === "anthropic" ? "claude-opus-5-5" : "gpt-5-codex";
  const source = opts.provider === "anthropic" ? "claude-code" : "codex";
  let t = Date.UTC(2026, 10, 10, 9, 0, 0);
  const calls: CallRecord[] = [];
  let context = 6000;

  for (let s = 0; s < sessions; s++) {
    const sessionId = `${opts.provider === "anthropic" ? "cc" : "cx"}-sess-${s}-0000-0000-0000-00000000${s}`;
    context = 6000;
    const steps: { kind: "reply" | "tool"; tool?: string; input: string; output: string }[] = [
      { kind: "reply", input: `Fix the flaky CSV export in ${CC_PATHS[0]} — rows are duplicated when a page boundary lands on an invoice with 2 line items. Run the tests when done.`, output: "I'll start by reading the export module and its test to find where pagination is handled." },
      { kind: "tool", tool: "Read", input: "[tool_result] (file contents)", output: "" },
      { kind: "tool", tool: "Read", input: "[tool_result] (test file contents)", output: "" },
      { kind: "reply", input: "[tool_result] (test file contents)", output: "The bug is in `paginate()`: it advances the cursor by page size rather than by invoice id, so a multi-line invoice straddling the boundary is emitted twice. I'll switch to an id-based cursor." },
      { kind: "tool", tool: "Edit", input: "[tool_result] ok", output: "" },
      { kind: "tool", tool: "Bash", input: "[tool_result] edit applied", output: "" },
      { kind: "reply", input: "[tool_result] 14 passed, 1 failed: export > handles empty page", output: "One test fails because the empty-page case now returns `undefined`. I'll return an empty array instead." },
      { kind: "tool", tool: "Edit", input: "[tool_result] ok", output: "" },
      { kind: "tool", tool: "Bash", input: "[tool_result] edit applied", output: "" },
      { kind: "reply", input: "[tool_result] 15 passed", output: "All 15 tests pass. The duplicate rows came from an offset-based cursor; the export now pages by invoice id, with a regression test for the page-boundary case." },
      { kind: "tool", tool: "Bash", input: "Write a one-line conventional commit message for this change.", output: "" },
      { kind: "reply", input: "Write a one-line conventional commit message for this change.", output: "fix(export): page by invoice id to stop duplicate rows at page boundaries" },
    ];
    for (const st of steps) {
      t += jitter(r, 6000, 0.5);
      const fresh = jitter(r, st.kind === "reply" ? 1800 : 900, 0.3);
      const cached = context;
      context += fresh + 400;
      const outTok = st.kind === "tool" ? jitter(r, 140, 0.4) : jitter(r, Math.max(30, estimateTokens(st.output)), 0.2);
      calls.push({
        id: `${opts.provider === "anthropic" ? "msg" : "req"}_${calls.length.toString().padStart(4, "0")}`,
        sessionId,
        timestamp: t,
        provider: opts.provider,
        model,
        task: `${source === "claude-code" ? "claude-code" : "codex"}:${st.kind === "tool" ? `tool:${st.tool}` : "reply"}`,
        input: st.input,
        output: st.output,
        inputTokens: fresh + cached,
        outputTokens: outTok,
        cachedInputTokens: cached,
        tools: st.kind === "tool" ? [st.tool!] : undefined,
        source,
      });
    }
  }
  return calls;
}

// ---------- renderers: canonical calls -> raw tool exports ----------

const iso = (ms: number | null) => new Date(ms ?? 0).toISOString();

export function renderLangSmith(calls: CallRecord[]): string {
  const msg = (cls: string, content: string) => ({ lc: 1, type: "constructor", id: ["langchain", "schema", "messages", cls], kwargs: { content } });
  const runs: unknown[] = [];
  const sessions = new Map<string, CallRecord[]>();
  for (const c of calls) sessions.set(c.sessionId, [...(sessions.get(c.sessionId) ?? []), c]);
  for (const [sid, group] of sessions) {
    runs.push({ id: `chain-${sid}`, name: "support_pipeline", run_type: "chain", trace_id: sid, start_time: iso(group[0].timestamp), inputs: { ticket: "…" }, outputs: { done: true } });
  }
  for (const c of calls) {
    const start = c.timestamp ?? 0;
    runs.push({
      id: c.id,
      name: c.task,
      run_type: "llm",
      trace_id: c.sessionId,
      parent_run_id: `chain-${c.sessionId}`,
      start_time: iso(start),
      end_time: iso(start + (c.latencyMs ?? 800)),
      inputs: { messages: [[...(c.system ? [msg("SystemMessage", c.system)] : []), msg("HumanMessage", c.input)]] },
      outputs: {
        generations: [[{ text: c.output, message: msg("AIMessage", c.output) }]],
        llm_output: { token_usage: { prompt_tokens: c.inputTokens, completion_tokens: c.outputTokens, total_tokens: c.inputTokens + c.outputTokens }, model_name: c.model },
      },
      prompt_tokens: c.inputTokens,
      completion_tokens: c.outputTokens,
      total_tokens: c.inputTokens + c.outputTokens,
      extra: { invocation_params: { model: c.model, temperature: c.temperature }, metadata: { ls_provider: c.provider, ls_model_name: c.model } },
    });
  }
  return JSON.stringify(runs, null, 1);
}

const sv = (stringValue: string) => ({ stringValue });
const iv = (n: number) => ({ intValue: String(n) });

/** OTLP/JSON: OpenAI-provider calls as OTel GenAI semconv (OpenLLMetry style), Anthropic calls as OpenInference. */
export function renderOtlp(calls: CallRecord[]): string {
  const spans = calls.map((c, i) => {
    const startMs = c.timestamp ?? 0;
    const start = `${startMs}000000`;
    const end = `${startMs + (c.latencyMs ?? 800)}000000`;
    const attributes: { key: string; value: unknown }[] = [];
    const a = (key: string, value: unknown) => attributes.push({ key, value });
    if (c.provider === "anthropic") {
      a("openinference.span.kind", sv("LLM"));
      a("llm.model_name", sv(c.model));
      a("llm.provider", sv("anthropic"));
      let k = 0;
      if (c.system) {
        a(`llm.input_messages.${k}.message.role`, sv("system"));
        a(`llm.input_messages.${k++}.message.content`, sv(c.system));
      }
      a(`llm.input_messages.${k}.message.role`, sv("user"));
      a(`llm.input_messages.${k}.message.content`, sv(c.input));
      a("llm.output_messages.0.message.role", sv("assistant"));
      a("llm.output_messages.0.message.content", sv(c.output));
      a("llm.token_count.prompt", iv(c.inputTokens));
      a("llm.token_count.completion", iv(c.outputTokens));
      a("session.id", sv(c.sessionId));
      a("llm.invocation_parameters", sv(JSON.stringify({ temperature: c.temperature ?? 0 })));
    } else {
      a("gen_ai.operation.name", sv("chat"));
      a("gen_ai.system", sv("openai"));
      a("gen_ai.request.model", sv(c.model));
      a("gen_ai.response.model", sv(c.model));
      a("gen_ai.request.temperature", { doubleValue: c.temperature ?? 0 });
      let k = 0;
      if (c.system) {
        a(`gen_ai.prompt.${k}.role`, sv("system"));
        a(`gen_ai.prompt.${k++}.content`, sv(c.system));
      }
      a(`gen_ai.prompt.${k}.role`, sv("user"));
      a(`gen_ai.prompt.${k}.content`, sv(c.input));
      a("gen_ai.completion.0.role", sv("assistant"));
      a("gen_ai.completion.0.content", sv(c.output));
      a("gen_ai.usage.input_tokens", iv(c.inputTokens));
      a("gen_ai.usage.output_tokens", iv(c.outputTokens));
      a("gen_ai.conversation.id", sv(c.sessionId));
    }
    return { traceId: c.sessionId.replace(/[^a-z0-9]/gi, "").padEnd(32, "0").slice(0, 32), spanId: i.toString(16).padStart(16, "0"), name: c.task, kind: 3, startTimeUnixNano: start, endTimeUnixNano: end, attributes };
  });
  // A non-LLM span to prove adapters skip it.
  spans.unshift({ traceId: "0".repeat(32), spanId: "f".repeat(16), name: "GET /tickets", kind: 2, startTimeUnixNano: "1", endTimeUnixNano: "2", attributes: [{ key: "http.method", value: sv("GET") }] });
  return JSON.stringify({ resourceSpans: [{ resource: { attributes: [{ key: "service.name", value: sv("support-ops-agent") }] }, scopeSpans: [{ scope: { name: "support-ops" }, spans }] }] });
}

/** OpenAI request/response log lines (JSONL) for the OpenAI-provider calls. No task name — real logs don't carry one. */
export function renderOpenAILogs(calls: CallRecord[]): string {
  return calls
    .filter((c) => c.provider === "openai")
    .map((c) =>
      JSON.stringify({
        request: { model: c.model, temperature: c.temperature ?? 0, messages: [...(c.system ? [{ role: "system", content: c.system }] : []), { role: "user", content: c.input }] },
        response: {
          id: `chatcmpl-${c.id}`,
          object: "chat.completion",
          created: Math.floor((c.timestamp ?? 0) / 1000),
          model: c.model,
          choices: [{ index: 0, message: { role: "assistant", content: c.output }, finish_reason: "stop" }],
          usage: { prompt_tokens: c.inputTokens, completion_tokens: c.outputTokens, total_tokens: c.inputTokens + c.outputTokens, prompt_tokens_details: { cached_tokens: c.cachedInputTokens ?? 0 } },
        },
        user: c.sessionId,
      }),
    )
    .join("\n");
}

/** Batch API pair: the input file and the output file, joined by custom_id. */
export function renderOpenAIBatch(calls: CallRecord[]): { input: string; output: string } {
  const oa = calls.filter((c) => c.provider === "openai");
  const input = oa.map((c) => JSON.stringify({ custom_id: c.id, method: "POST", url: "/v1/chat/completions", body: { model: c.model, messages: [...(c.system ? [{ role: "system", content: c.system }] : []), { role: "user", content: c.input }] } })).join("\n");
  const output = oa
    .map((c) =>
      JSON.stringify({
        id: `batch_req_${c.id}`,
        custom_id: c.id,
        response: {
          status_code: 200,
          request_id: `req_${c.id}`,
          body: { id: `chatcmpl-${c.id}`, object: "chat.completion", created: Math.floor((c.timestamp ?? 0) / 1000), model: c.model, choices: [{ index: 0, message: { role: "assistant", content: c.output } }], usage: { prompt_tokens: c.inputTokens, completion_tokens: c.outputTokens } },
        },
        error: null,
      }),
    )
    .join("\n");
  return { input, output };
}

export function renderClaudeCode(calls: CallRecord[]): string {
  const lines: unknown[] = [];
  let prev: string | null = null;
  for (const c of calls) {
    const userUuid = `u-${c.id}`;
    const isTool = c.input.startsWith("[tool_result]");
    lines.push({
      parentUuid: prev,
      isSidechain: false,
      sessionId: c.sessionId,
      type: "user",
      uuid: userUuid,
      timestamp: iso((c.timestamp ?? 0) - 1500),
      cwd: "/Users/jane.cho/dev/billing-api",
      message: { role: "user", content: isTool ? [{ type: "tool_result", tool_use_id: `toolu_${c.id}`, content: c.input.replace("[tool_result] ", "") }] : c.input },
    });
    const cacheRead = c.cachedInputTokens ?? 0;
    const fresh = c.inputTokens - cacheRead;
    const blocks: unknown[] = [];
    if (c.output) blocks.push({ type: "text", text: c.output });
    for (const tool of c.tools ?? []) blocks.push({ type: "tool_use", id: `toolu_${c.id}`, name: tool, input: { file_path: CC_PATHS[0] } });
    blocks.forEach((b, i) => {
      lines.push({
        parentUuid: userUuid,
        isSidechain: false,
        sessionId: c.sessionId,
        type: "assistant",
        uuid: `a-${c.id}-${i}`,
        timestamp: iso(c.timestamp),
        requestId: `req_${c.id}`,
        message: {
          id: c.id,
          type: "message",
          role: "assistant",
          model: c.model,
          content: [b],
          // Claude Code streams a partial output_tokens on early blocks; the last line carries the settled count.
          usage: { input_tokens: fresh, cache_creation_input_tokens: 0, cache_read_input_tokens: cacheRead, output_tokens: i === blocks.length - 1 ? c.outputTokens : 1 },
        },
      });
    });
    prev = `a-${c.id}-${blocks.length - 1}`;
  }
  return lines.map((l) => JSON.stringify(l)).join("\n");
}

export function renderCodex(calls: CallRecord[]): string {
  const lines: unknown[] = [];
  const seenSession = new Set<string>();
  let total = 0;
  for (const c of calls) {
    const ts = iso(c.timestamp);
    if (!seenSession.has(c.sessionId)) {
      seenSession.add(c.sessionId);
      total = 0;
      lines.push({ timestamp: ts, type: "session_meta", payload: { id: c.sessionId, cwd: "/Users/jane.cho/dev/billing-api", originator: "codex_cli_rs", cli_version: "0.9.0", instructions: "You are a coding agent running in the Codex CLI. Prefer small, verified edits and run the test suite before finishing." } });
      lines.push({ timestamp: ts, type: "turn_context", payload: { cwd: "/Users/jane.cho/dev/billing-api", approval_policy: "on-request", model: c.model, effort: "medium" } });
    }
    if (c.input.startsWith("[tool_result]")) {
      lines.push({ timestamp: ts, type: "response_item", payload: { type: "function_call_output", call_id: `call_${c.id}`, output: c.input.replace("[tool_result] ", "") } });
    } else {
      lines.push({ timestamp: ts, type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: c.input }] } });
    }
    lines.push({ timestamp: ts, type: "response_item", payload: { type: "reasoning", summary: [], content: null } });
    if (c.output) lines.push({ timestamp: ts, type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: c.output }] } });
    for (const tool of c.tools ?? []) lines.push({ timestamp: ts, type: "response_item", payload: { type: "function_call", name: tool.toLowerCase(), arguments: JSON.stringify({ command: ["cat", CC_PATHS[0]] }), call_id: `call_${c.id}` } });

    total += c.inputTokens + c.outputTokens;
    const usage = { input_tokens: c.inputTokens, cached_input_tokens: c.cachedInputTokens ?? 0, output_tokens: c.outputTokens, reasoning_output_tokens: 0, total_tokens: c.inputTokens + c.outputTokens };
    const tokenCount = { timestamp: ts, type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { ...usage, total_tokens: total }, last_token_usage: usage, model_context_window: 272000 } } };
    lines.push(tokenCount);
    lines.push(tokenCount); // Codex re-emits identical token_count events; the adapter must not double-count.
  }
  return lines.map((l) => JSON.stringify(l)).join("\n");
}

export interface SampleDataset {
  id: string;
  label: string;
  description: string;
  format: CallRecord["source"];
  /** Raw export text exactly as the originating tool would write it. */
  raw: () => string;
}

export const SAMPLE_DATASETS: SampleDataset[] = [
  { id: "langsmith-support-ops", label: "LangSmith — support ops", description: "90 tickets through a LangChain support pipeline, exported from LangSmith.", format: "langsmith", raw: () => renderLangSmith(generateSupportOpsCalls()) },
  { id: "otel-support-ops", label: "OpenTelemetry — support ops", description: "The same pipeline traced with OTLP: OpenAI calls as GenAI semconv, Anthropic calls as OpenInference.", format: "otel", raw: () => renderOtlp(generateSupportOpsCalls()) },
  { id: "openai-support-ops", label: "OpenAI logs — support ops", description: "Request/response logs for the OpenAI-served tasks only.", format: "openai", raw: () => renderOpenAILogs(generateSupportOpsCalls()) },
  { id: "claude-code-sessions", label: "Claude Code — coding sessions", description: "Three agentic bug-fix sessions from Claude Code transcripts.", format: "claude-code", raw: () => renderClaudeCode(generateCodingCalls({ provider: "anthropic" })) },
  { id: "codex-sessions", label: "Codex — coding sessions", description: "Three agentic bug-fix sessions from Codex CLI rollout files.", format: "codex", raw: () => renderCodex(generateCodingCalls({ provider: "openai" })) },
];
