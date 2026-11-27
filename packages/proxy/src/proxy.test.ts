import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createProxy, type ProxyOptions } from "./server";
import { generateSupportOpsCalls } from "../../../src/lib/ingest/sample-data";
import { replayCalls } from "../../../src/lib/shadow/replay";
import { approvedTaskKeys } from "../../../src/lib/shadow/summarize";
import { GatewayEngine } from "../../../src/lib/gateway/engine";

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });
}

interface Upstream {
  url: string;
  calls: { path: string; body: Record<string, unknown>; headers: http.IncomingHttpHeaders }[];
  close: () => Promise<void>;
}

/** A fake OpenAI+Anthropic that answers deterministically: "answer:<last user message>". */
async function startUpstream(): Promise<Upstream> {
  const calls: Upstream["calls"] = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) : {};
      calls.push({ path: req.url ?? "", body, headers: req.headers });
      const last = ((body.messages ?? []) as { content: unknown }[]).at(-1)?.content;
      const text = `answer:${typeof last === "string" ? last : JSON.stringify(last)}`;
      if (req.url === "/v1/chat/completions") {
        if (body.tools) {
          res.writeHead(200, { "content-type": "application/json" });
          return res.end(JSON.stringify({ id: "c", object: "chat.completion", model: body.model, choices: [{ index: 0, message: { role: "assistant", content: null, tool_calls: [{ id: "t", type: "function", function: { name: "f", arguments: "{}" } }] }, finish_reason: "tool_calls" }], usage: { prompt_tokens: 50, completion_tokens: 5 } }));
        }
        if (body.stream) {
          res.writeHead(200, { "content-type": "text/event-stream" });
          const f = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;
          res.write(f({ id: "c", model: body.model, choices: [{ index: 0, delta: { role: "assistant", content: "" } }] }));
          res.write(f({ id: "c", model: body.model, choices: [{ index: 0, delta: { content: text } }] }));
          res.write(f({ id: "c", model: body.model, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 100, completion_tokens: 20 } }));
          return res.end("data: [DONE]\n\n");
        }
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ id: "c", object: "chat.completion", model: body.model, choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }], usage: { prompt_tokens: 100, completion_tokens: 20 } }));
      }
      if (req.url === "/v1/messages") {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ id: "m", type: "message", role: "assistant", model: body.model, content: [{ type: "text", text }], stop_reason: "end_turn", usage: { input_tokens: 100, output_tokens: 20 } }));
      }
      res.writeHead(404).end("{}");
    });
  });
  await new Promise<void>((r) => server.listen(0, r));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, calls, close: () => closeServer(server) };
}

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

async function setup(opts: ProxyOptions = {}) {
  const up = await startUpstream();
  const proxy = createProxy({ openaiUpstream: up.url, anthropicUpstream: up.url, ...opts });
  await new Promise<void>((r) => proxy.server.listen(0, r));
  const base = `http://127.0.0.1:${(proxy.server.address() as AddressInfo).port}`;
  cleanups.push(() => closeServer(proxy.server), up.close);
  const chat = (body: Record<string, unknown>, headers: Record<string, string> = {}) =>
    fetch(`${base}/v1/chat/completions`, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer sk-test", ...headers }, body: JSON.stringify(body) });
  return { up, proxy, base, chat };
}

const SYSTEM = "You are a support assistant. Categorize the customer's ticket into one category.";
const req = (content: string, extra: Record<string, unknown> = {}) => ({ model: "gpt-4.1", temperature: 0, messages: [{ role: "system", content: SYSTEM }, { role: "user", content }], ...extra });

describe("shadow mode (default)", () => {
  it("forwards every request unchanged and records what it would have done", async () => {
    const { up, proxy, chat } = await setup();
    for (let i = 0; i < 12; i++) {
      const r = await chat(req("reset my password"));
      expect(r.status).toBe(200);
      expect((await r.json()).choices[0].message.content).toBe("answer:reset my password");
    }
    expect(up.calls).toHaveLength(12); // nothing was served from cache
    expect(up.calls.every((c) => c.body.model === "gpt-4.1")).toBe(true);
    expect(up.calls[0].headers.authorization).toBe("Bearer sk-test"); // client's key passes through
    const rows = proxy.ledger.all();
    const wouldHit = rows.filter((r) => r.action === "cache-hit");
    expect(wouldHit.length).toBeGreaterThan(0);
    expect(wouldHit.every((r) => r.verification === "verified-equal" && !r.enforced)).toBe(true);
  });

  it("exposes stats", async () => {
    const { base, chat } = await setup();
    for (let i = 0; i < 10; i++) await chat(req("same"));
    const stats = await (await fetch(`${base}/__routewise/stats`)).json();
    expect(stats.mode).toBe("shadow");
    expect(stats.summary.calls).toBe(10);
  });
});

describe("enforce mode", () => {
  it("serves repeats from cache (JSON and SSE) without touching the upstream", async () => {
    const { up, chat } = await setup({ mode: "enforce" });
    for (let i = 0; i < 10; i++) await chat(req("reset my password"));
    const before = up.calls.length;

    const hit = await chat(req("reset my password"));
    expect(hit.headers.get("x-routewise-action")).toBe("cache-hit");
    const body = await hit.json();
    expect(body.object).toBe("chat.completion");
    expect(body.choices[0].message.content).toBe("answer:reset my password");

    const sse = await chat(req("reset my password", { stream: true }));
    const text = await sse.text();
    expect(sse.headers.get("content-type")).toContain("text/event-stream");
    expect(text).toContain("answer:reset my password");
    expect(text.trim().endsWith("data: [DONE]")).toBe(true);
    expect(up.calls.length).toBe(before); // zero upstream calls for both
  });

  it("downgrades a cacheable-task miss to the cheaper tier model", async () => {
    const { up, chat } = await setup({ mode: "enforce" });
    for (let i = 0; i < 10; i++) await chat(req(`ticket number ${i}`));
    const r = await chat(req("a brand new ticket"));
    expect(r.headers.get("x-routewise-action")).toBe("downgrade");
    expect(up.calls.at(-1)!.body.model).toBe("gpt-4o-mini");
  });

  it("never downgrades calls that define tools, and honors the bypass header", async () => {
    const { up, chat } = await setup({ mode: "enforce" });
    for (let i = 0; i < 10; i++) await chat(req(`ticket number ${i}`));
    await chat(req("new one", { tools: [{ type: "function", function: { name: "f", parameters: {} } }] }));
    expect(up.calls.at(-1)!.body.model).toBe("gpt-4.1");
    await chat(req("another new one"), { "x-routewise-bypass": "1" });
    expect(up.calls.at(-1)!.body.model).toBe("gpt-4.1");
  });

  it("does not cache above the temperature limit", async () => {
    const { up, chat } = await setup({ mode: "enforce" });
    for (let i = 0; i < 14; i++) await chat(req("same", { temperature: 1 }));
    expect(up.calls.length).toBe(14);
  });

  it("only acts on tasks approved by a shadow run", async () => {
    const engine = new GatewayEngine();
    engine.restrictTo([]); // nothing approved
    const { up, chat } = await setup({ mode: "enforce", engine });
    for (let i = 0; i < 14; i++) await chat(req("same"));
    expect(up.calls.length).toBe(14);
  });

  it("streams upstream SSE through untouched", async () => {
    const { chat } = await setup({ mode: "enforce" });
    const r = await chat(req("hello", { stream: true }));
    const text = await r.text();
    expect(text).toContain('"content":"answer:hello"');
    expect(text).toContain("[DONE]");
  });

  it("speaks Anthropic: caches and synthesizes a messages response", async () => {
    const { up, base } = await setup({ mode: "enforce" });
    const call = () =>
      fetch(`${base}/v1/messages`, { method: "POST", headers: { "content-type": "application/json", "x-api-key": "k", "anthropic-version": "2023-06-01" }, body: JSON.stringify({ model: "claude-sonnet-5-5", max_tokens: 100, temperature: 0, system: SYSTEM, messages: [{ role: "user", content: "same" }] }) });
    for (let i = 0; i < 10; i++) await call();
    const n = up.calls.length;
    const hit = await call();
    const body = await hit.json();
    expect(hit.headers.get("x-routewise-action")).toBe("cache-hit");
    expect(body.type).toBe("message");
    expect(body.content[0].text).toBe("answer:same");
    expect(up.calls.length).toBe(n);
  });

  it("passes unrelated endpoints and unknown JSON straight through", async () => {
    const { base } = await setup({ mode: "enforce" });
    const r = await fetch(`${base}/v1/embeddings`, { method: "POST", body: "{}" });
    expect(r.status).toBe(404); // the upstream's own answer, relayed
  });

  it("502s cleanly when the upstream is down", async () => {
    const proxy = createProxy({ openaiUpstream: "http://127.0.0.1:1" });
    await new Promise<void>((r) => proxy.server.listen(0, r));
    cleanups.push(() => closeServer(proxy.server));
    const r = await fetch(`http://127.0.0.1:${(proxy.server.address() as AddressInfo).port}/v1/chat/completions`, { method: "POST", body: JSON.stringify(req("x")) });
    expect(r.status).toBe(502);
  });
});

describe("shadow-then-enforce workflow", () => {
  it("a replayed recorded trace warms the engine and gates enforcement to approved tasks", async () => {
    const calls = generateSupportOpsCalls();
    const engine = new GatewayEngine();
    const replay = replayCalls(calls, { engine });
    const approved = approvedTaskKeys(replay.summary);
    engine.restrictTo(approved);
    expect(approved.length).toBeGreaterThan(0);
    expect(approved.length).toBeLessThan(replay.summary.tasks.length);
    const { up, base } = await setup({ mode: "enforce", engine });
    // The KB-answer task was approved and its answers are warm in the cache: a recorded question needs no upstream call,
    // even though the live request carries no task name (identity comes from the system prompt).
    const kb = calls.find((c) => c.task === "kb_answer")!;
    const r = await fetch(`${base}/v1/messages`, { method: "POST", headers: { "content-type": "application/json", "x-api-key": "k", "anthropic-version": "2023-06-01" }, body: JSON.stringify({ model: "claude-sonnet-5-5", max_tokens: 300, temperature: 0, system: kb.system, messages: [{ role: "user", content: kb.input }] }) });
    expect(r.headers.get("x-routewise-action")).toBe("cache-hit");
    expect(up.calls).toHaveLength(0);
  });
});
