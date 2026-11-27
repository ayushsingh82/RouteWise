import http from "node:http";
import { randomUUID } from "node:crypto";
import { priceTokens, resolveTier } from "../../../src/lib/workflow/pricing";
import { GatewayEngine } from "../../../src/lib/gateway/engine";
import { DEFAULT_GATEWAY_POLICY, type GatewayPolicy } from "../../../src/lib/gateway/policy";
import type { DecisionRecord, GatewayDecision, GatewayRequest, Verification } from "../../../src/lib/gateway/types";
import { approvedTaskKeys, summarizeDecisions } from "../../../src/lib/shadow/summarize";
import { isRec, type Rec } from "../../../src/lib/ingest/util";
import { taskLabel, normalizeInput } from "../../../src/lib/ingest/to-trace-shared";
import { Ledger } from "./ledger";
import { matchApi, parseJsonResponse, providerOf, SseCollector, synthesizeResponse, toGatewayRequest, type ApiKind } from "./providers";

export type ProxyMode = "shadow" | "enforce";

export interface ProxyOptions {
  /** "shadow" (default): forward every request unchanged and only record what the policy *would* have done. "enforce": actually cache and downgrade. */
  mode?: ProxyMode;
  openaiUpstream?: string;
  anthropicUpstream?: string;
  policy?: GatewayPolicy;
  /** Reuse an engine, e.g. one pre-warmed by replaying a recorded trace. */
  engine?: GatewayEngine;
  ledgerFile?: string;
  /** Logger; defaults to silent. */
  log?: (msg: string) => void;
}

export interface Proxy {
  server: http.Server;
  engine: GatewayEngine;
  ledger: Ledger;
  mode: ProxyMode;
}

const HOP_BY_HOP = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade", "host", "content-length", "accept-encoding"]);
const MAX_BODY = 20 * 1024 * 1024;

function readBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error("Request body too large"));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function forwardHeaders(req: http.IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (HOP_BY_HOP.has(k.toLowerCase()) || v === undefined) continue;
    out[k] = Array.isArray(v) ? v.join(", ") : v;
  }
  return out;
}

export function createProxy(opts: ProxyOptions = {}): Proxy {
  const mode: ProxyMode = opts.mode ?? "shadow";
  const policy = opts.policy ?? DEFAULT_GATEWAY_POLICY;
  const engine = opts.engine ?? new GatewayEngine(policy);
  const ledger = new Ledger(opts.ledgerFile);
  const log = opts.log ?? (() => {});
  const upstreams = { openai: (opts.openaiUpstream ?? "https://api.openai.com").replace(/\/$/, ""), anthropic: (opts.anthropicUpstream ?? "https://api.anthropic.com").replace(/\/$/, "") };

  const upstreamFor = (req: http.IncomingMessage, api: ApiKind | null) =>
    api ? upstreams[providerOf(api) === "anthropic" ? "anthropic" : "openai"] : req.headers["x-api-key"] || req.headers["anthropic-version"] ? upstreams.anthropic : upstreams.openai;

  async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://proxy.local");

    if (url.pathname === "/__routewise/health") return json(res, 200, { ok: true, mode });
    if (url.pathname === "/__routewise/stats") {
      const summary = summarizeDecisions(ledger.all());
      return json(res, 200, { mode, engine: engine.stats(), summary, approvedTaskKeys: approvedTaskKeys(summary) });
    }

    const api = matchApi(url.pathname);
    const body = req.method === "GET" || req.method === "HEAD" ? Buffer.alloc(0) : await readBody(req);
    const target = `${upstreamFor(req, api)}${url.pathname}${url.search}`;

    let parsed: Rec | null = null;
    let gw: GatewayRequest | null = null;
    if (api && body.length > 0) {
      try {
        const j: unknown = JSON.parse(body.toString("utf8"));
        if (isRec(j)) {
          parsed = j;
          const taskHeader = req.headers["x-routewise-task"];
          gw = toGatewayRequest(api, j, typeof taskHeader === "string" ? taskHeader : undefined);
        }
      } catch {
        /* not JSON: forward as-is */
      }
    }

    // Anything we can't or shouldn't touch is a transparent pass-through.
    if (!api || !gw || !parsed || req.headers["x-routewise-bypass"]) return passthrough(req, res, target, body);

    const decision = engine.decide(gw);
    const acting = mode === "enforce";
    const inputChars = body.length;

    // ---- cache hit (enforce): answer locally ----
    if (acting && decision.action === "cache-hit" && decision.cached) {
      const { body: out, contentType } = synthesizeResponse(api, decision.cached, gw.stream === true);
      res.writeHead(200, { "content-type": contentType, "x-routewise-action": "cache-hit", "x-routewise-task": decision.taskKey });
      res.end(out);
      const tier = resolveTier(gw.model);
      const baseline = priceTokens(tier, decision.cached.inputTokens, decision.cached.outputTokens, policy.pricing);
      addRecord(gw, decision, { baselineUsd: baseline, policyUsd: 0, inputTokens: decision.cached.inputTokens, outputTokens: decision.cached.outputTokens, verification: "n/a", enforced: true });
      return;
    }

    // ---- forward (possibly with a downgraded model) ----
    const downgrade = acting && decision.action === "downgrade";
    const sendBody = downgrade ? Buffer.from(JSON.stringify({ ...parsed, model: decision.targetModel })) : body;
    const upstream = await fetch(target, { method: req.method, headers: forwardHeaders(req), body: sendBody.length ? new Uint8Array(sendBody) : undefined });

    const headers: Record<string, string> = {};
    upstream.headers.forEach((v, k) => {
      if (!HOP_BY_HOP.has(k.toLowerCase()) && k.toLowerCase() !== "content-encoding") headers[k] = v;
    });
    headers["x-routewise-action"] = acting ? decision.action : `shadow:${decision.action}`;
    headers["x-routewise-task"] = decision.taskKey;
    if (downgrade) headers["x-routewise-model"] = decision.targetModel;

    const isStream = (upstream.headers.get("content-type") ?? "").includes("text/event-stream");
    let result;
    if (isStream && upstream.body) {
      res.writeHead(upstream.status, headers);
      const collector = new SseCollector(api);
      const decoder = new TextDecoder();
      const reader = upstream.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
        collector.push(decoder.decode(value, { stream: true }));
      }
      res.end();
      result = collector.result(decision.targetModel, inputChars);
    } else {
      const text = await upstream.text();
      res.writeHead(upstream.status, headers);
      res.end(text);
      try {
        const j: unknown = JSON.parse(text);
        result = upstream.ok && isRec(j) ? parseJsonResponse(api, j, decision.targetModel, inputChars) : null;
      } catch {
        result = null;
      }
    }
    if (!result || !upstream.ok) return;

    // ---- account for it and learn ----
    const requestedTier = resolveTier(gw.model);
    const usedTier = downgrade ? decision.targetTier : requestedTier;
    const baselineUsd = priceTokens(requestedTier, result.inputTokens, result.outputTokens, policy.pricing);
    let policyUsd = baselineUsd;
    let verification: Verification = "n/a";
    if (acting) {
      policyUsd = priceTokens(usedTier, result.inputTokens, result.outputTokens, policy.pricing);
    } else if (decision.action === "cache-hit" && decision.cached) {
      policyUsd = 0;
      verification = normalizeInput(decision.cached.output) === normalizeInput(result.output) ? "verified-equal" : "diverged";
    } else if (decision.action === "downgrade") {
      policyUsd = priceTokens(decision.targetTier, result.inputTokens, result.outputTokens, policy.pricing);
      verification = "unverified";
    }
    addRecord(gw, decision, { baselineUsd, policyUsd, inputTokens: result.inputTokens, outputTokens: result.outputTokens, verification, enforced: acting });
    engine.record(gw, { output: result.output, inputTokens: result.inputTokens, outputTokens: result.outputTokens, model: result.model, cacheable: result.complete });
  }

  function addRecord(gw: GatewayRequest, d: GatewayDecision, r: Pick<DecisionRecord, "baselineUsd" | "policyUsd" | "inputTokens" | "outputTokens" | "verification" | "enforced">): void {
    ledger.add({
      id: randomUUID(),
      ts: Date.now(),
      task: taskLabel({ task: gw.task, system: gw.system, model: gw.model }),
      taskKey: d.taskKey,
      action: d.action,
      classification: d.classification,
      confidence: d.confidence,
      requestedModel: gw.model,
      usedModel: d.action === "downgrade" && r.enforced ? d.targetModel : gw.model,
      ...r,
    });
    log(`${r.enforced ? "" : "[shadow] "}${d.action} ${gw.model}${d.action === "downgrade" ? ` -> ${d.targetModel}` : ""} (${d.classification}) ${d.reason}`);
  }

  async function passthrough(req: http.IncomingMessage, res: http.ServerResponse, target: string, body: Buffer): Promise<void> {
    const upstream = await fetch(target, { method: req.method, headers: forwardHeaders(req), body: body.length ? new Uint8Array(body) : undefined });
    const headers: Record<string, string> = {};
    upstream.headers.forEach((v, k) => {
      if (!HOP_BY_HOP.has(k.toLowerCase()) && k.toLowerCase() !== "content-encoding") headers[k] = v;
    });
    res.writeHead(upstream.status, headers);
    if (upstream.body) {
      const reader = upstream.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
    }
    res.end();
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      log(`error: ${err instanceof Error ? err.message : String(err)}`);
      if (!res.headersSent) json(res, 502, { error: { message: "RouteWise proxy could not reach the upstream provider.", type: "routewise_proxy_error" } });
      else res.end();
    });
  });
  return { server, engine, ledger, mode };
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}
