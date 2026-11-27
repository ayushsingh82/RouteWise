#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { createProxy, type ProxyMode } from "./server";
import { GatewayEngine } from "../../../src/lib/gateway/engine";
import { DEFAULT_GATEWAY_POLICY } from "../../../src/lib/gateway/policy";
import { replayCalls } from "../../../src/lib/shadow/replay";
import { approvedTaskKeys, summarizeDecisions } from "../../../src/lib/shadow/summarize";
import { loadCalls } from "../../../src/lib/ingest/load";
import type { DecisionRecord } from "../../../src/lib/gateway/types";

const HELP = `routewise-proxy — drop-in OpenAI/Anthropic proxy that classifies, caches and routes LLM calls

Usage: routewise-proxy [options]

  --port <n>                 listen port (default 8787)
  --mode <shadow|enforce>    shadow (default): forward everything unchanged, record what the policy WOULD do
                             enforce: actually serve cache hits and downgrade models
  --shadow-trace <file>      replay this recorded trace (LangSmith / OTLP / Claude Code / Codex / OpenAI logs / calls.json)
                             before starting; in enforce mode only tasks that pass shadow are acted on
  --approve-from <ledger>    enforce only tasks that passed shadow in a previous live run's ledger (JSONL)
  --approve-all              enforce on every task without shadow evidence (not recommended)
  --ledger <file>            append a JSONL decision ledger (metadata only — no prompts or keys)
  --openai-upstream <url>    default https://api.openai.com
  --anthropic-upstream <url> default https://api.anthropic.com
  --verbose

Point your client at it:   OPENAI_BASE_URL=http://localhost:8787/v1     ANTHROPIC_BASE_URL=http://localhost:8787
Optional per-request headers:  x-routewise-task: <name>   x-routewise-bypass: 1
Stats:  GET /__routewise/stats`;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : (process.argv[i + 1] ?? "true");
}
const has = (n: string) => process.argv.includes(`--${n}`);

function fail(msg: string): never {
  console.error(`routewise-proxy: ${msg}`);
  process.exit(1);
}

if (has("help") || has("h")) {
  console.log(HELP);
  process.exit(0);
}

const mode = (arg("mode") ?? process.env.ROUTEWISE_MODE ?? "shadow") as ProxyMode;
if (mode !== "shadow" && mode !== "enforce") fail(`--mode must be "shadow" or "enforce", got "${mode}"`);
const port = Number(arg("port") ?? process.env.PORT ?? 8787);
const engine = new GatewayEngine(DEFAULT_GATEWAY_POLICY);

let approved: string[] | null = null;

const traceFile = arg("shadow-trace");
if (traceFile) {
  const { calls, source } = loadCalls(readFileSync(traceFile, "utf8"));
  const replay = replayCalls(calls, { engine });
  approved = approvedTaskKeys(replay.summary);
  const s = replay.summary;
  console.log(`Shadow replay of ${s.calls} recorded ${source} calls: policy saves ${(s.savedPct * 100).toFixed(1)}% (${(s.verifiedSavedUsd / Math.max(s.baselineUsd, 1e-12) * 100).toFixed(1)}% output-verified)`);
  for (const t of s.tasks) console.log(`  ${t.verdict.padEnd(22)} ${t.task.slice(0, 50).padEnd(50)} saved ${(t.savedPct * 100).toFixed(0)}%  verified ${t.verifiedEqual}/${t.verifiedEqual + t.diverged}`);
}

const approveFrom = arg("approve-from");
if (approveFrom) {
  const rows: DecisionRecord[] = readFileSync(approveFrom, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  approved = [...new Set([...(approved ?? []), ...approvedTaskKeys(summarizeDecisions(rows))])];
}

if (mode === "enforce") {
  if (has("approve-all")) {
    console.warn("WARNING: --approve-all — enforcing without shadow evidence.");
  } else if (approved === null) {
    fail("enforce mode needs shadow evidence first: pass --shadow-trace <file> or --approve-from <ledger>, or run in shadow mode and review /__routewise/stats. (Use --approve-all to skip this.)");
  } else {
    engine.restrictTo(approved);
    console.log(`Enforcing on ${approved.length} shadow-approved task(s); everything else passes through.`);
  }
}

const proxy = createProxy({
  mode,
  engine,
  ledgerFile: arg("ledger"),
  openaiUpstream: arg("openai-upstream") ?? process.env.OPENAI_UPSTREAM,
  anthropicUpstream: arg("anthropic-upstream") ?? process.env.ANTHROPIC_UPSTREAM,
  log: has("verbose") ? (m) => console.log(m) : undefined,
});

proxy.server.listen(port, () => {
  console.log(`routewise-proxy listening on http://localhost:${port} (${mode} mode)`);
  if (mode === "shadow") console.log("Shadow mode: requests are forwarded unchanged. See GET /__routewise/stats for what enforcing would save.");
});
