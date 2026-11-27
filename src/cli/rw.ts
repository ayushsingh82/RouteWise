import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadCalls } from "@/lib/ingest/load";
import { anonymizeCalls } from "@/lib/ingest/anonymize";
import { TRACE_SOURCES, type CallRecord, type TraceSource } from "@/lib/ingest/types";
import { SAMPLE_DATASETS } from "@/lib/ingest/sample-data";
import { replayCalls } from "@/lib/shadow/replay";
import { benchmarkTask, casesFromCalls, recordedCandidate } from "@/lib/benchmark/benchmark";
import { anthropicCandidate, openaiCandidate } from "@/lib/benchmark/runners";
import { buildEvidenceReportFromCalls, TIER_INFO } from "@/lib/report/evidence";
import { renderHtml } from "@/lib/report/html";
import { renderPdf } from "@/lib/report/pdf";
import { badgeForReport } from "@/lib/report/badge";
import type { DecisionRecord } from "@/lib/gateway/types";

const USAGE = `RouteWise CLI

  rw ingest <trace> [--format <${TRACE_SOURCES.join("|")}>] [--anonymize] [--term <text>]... [--out calls.json]
  rw samples [--dir samples]
  rw shadow <trace> [--json]
  rw benchmark <trace> [--threshold 0.9] [--live <anthropic|openai> --model <id> --tier <non-frontier|near-frontier>]
  rw report <trace> [--html out.html] [--pdf out.pdf] [--badge out.svg] [--anonymize]
            [--ledger ledger.jsonl --invoice-usd <billed>] [--title <text>]

<trace> is a raw export (LangSmith, OTLP, Claude Code, Codex, OpenAI logs) or a calls.json written by "ingest --out".`;

interface Args {
  positional: string[];
  flags: Map<string, string[]>;
}

function parse(argv: string[]): Args {
  const flags = new Map<string, string[]>();
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const name = a.slice(2);
      const next = argv[i + 1];
      const value = next === undefined || next.startsWith("--") ? "true" : argv[++i];
      flags.set(name, [...(flags.get(name) ?? []), value]);
    } else positional.push(a);
  }
  return { positional, flags };
}

const flag = (a: Args, n: string) => a.flags.get(n)?.[0];
const has = (a: Args, n: string) => a.flags.has(n);

function load(a: Args): { calls: CallRecord[]; source: string; anonReport?: ReturnType<typeof anonymizeCalls>["report"] } {
  const file = a.positional[1];
  if (!file) throw new Error("Missing <trace> file.");
  const { source, calls } = loadCalls(readFileSync(file, "utf8"), { format: flag(a, "format") as TraceSource | undefined });
  if (has(a, "anonymize")) {
    const r = anonymizeCalls(calls, { knownTerms: a.flags.get("term") });
    return { calls: r.calls, source, anonReport: r.report };
  }
  return { calls, source };
}

const usd = (n: number) => `$${n.toFixed(4)}`;
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

async function main() {
  const a = parse(process.argv.slice(2));
  const cmd = a.positional[0];

  switch (cmd) {
    case "ingest": {
      const { calls, source, anonReport } = load(a);
      console.log(`Parsed ${calls.length} calls from ${source}: ${[...new Set(calls.map((c) => c.model))].join(", ")}`);
      if (anonReport) console.log(`Anonymized ${anonReport.total} values:`, anonReport.byCategory);
      const out = flag(a, "out");
      if (out) {
        writeFileSync(out, JSON.stringify(calls, null, 1));
        console.log(`Wrote ${out}`);
      }
      return;
    }
    case "samples": {
      const dir = flag(a, "dir") ?? "samples";
      mkdirSync(path.join(dir, "anonymized"), { recursive: true });
      const ext: Record<string, string> = { langsmith: "json", otel: "json", openai: "jsonl", "claude-code": "jsonl", codex: "jsonl" };
      for (const d of SAMPLE_DATASETS) {
        const raw = d.raw();
        writeFileSync(path.join(dir, `${d.id}.${ext[d.format]}`), raw);
        const { calls } = loadCalls(raw);
        const anon = anonymizeCalls(calls);
        writeFileSync(path.join(dir, "anonymized", `${d.id}.calls.json`), JSON.stringify(anon.calls, null, 1));
        console.log(`${d.id}: ${calls.length} calls, ${anon.report.total} values anonymized`);
      }
      return;
    }
    case "shadow": {
      const { calls } = load(a);
      const r = replayCalls(calls);
      if (has(a, "json")) return void console.log(JSON.stringify(r.summary, null, 2));
      const s = r.summary;
      console.log(`Shadow replay of ${s.calls} calls (nothing was called or changed)`);
      console.log(`  baseline ${usd(s.baselineUsd)} -> policy ${usd(s.policyUsd)}  saved ${usd(s.savedUsd)} (${pct(s.savedPct)}), of which output-verified ${usd(s.verifiedSavedUsd)}\n`);
      for (const t of s.tasks) {
        console.log(`  ${t.task.padEnd(26)} ${t.classification.padEnd(17)} calls=${String(t.calls).padEnd(4)} hit=${String(t.cacheHits).padEnd(3)} down=${String(t.downgrades).padEnd(3)} verified=${t.verifiedEqual}/${t.verifiedEqual + t.diverged} unverified=${t.unverified} saved=${pct(t.savedPct).padEnd(6)} ${t.verdict}`);
      }
      return;
    }
    case "benchmark": {
      const { calls } = load(a);
      const threshold = Number(flag(a, "threshold") ?? 0.9);
      const live = flag(a, "live");
      const tier = (flag(a, "tier") ?? "non-frontier") as "non-frontier" | "near-frontier";
      const cands = [];
      if (live) {
        const model = flag(a, "model");
        if (!model) throw new Error("--live requires --model");
        const apiKey = (live === "anthropic" ? process.env.ANTHROPIC_API_KEY : process.env.OPENAI_API_KEY) ?? "";
        if (!apiKey) throw new Error(`Set ${live === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY"} to run a live benchmark.`);
        cands.push(live === "anthropic" ? anthropicCandidate({ apiKey, model, tier }) : openaiCandidate({ apiKey, model, tier }));
      } else {
        cands.push(recordedCandidate(calls, "non-frontier"), recordedCandidate(calls, "near-frontier"));
      }
      for (const [, cases] of casesFromCalls(calls)) {
        const b = await benchmarkTask(cases, cands, { threshold });
        console.log(`${b.task}  (${b.cases} cases, labels: ${b.referenceKind})`);
        for (const r of b.results) console.log(`  ${r.candidateId.padEnd(28)} evaluated=${r.evaluated} skipped=${r.skipped} pass=${pct(r.passRate)} lower-bound=${pct(r.passRateLowerBound)} cost=${usd(r.costUsd)}`);
        console.log(`  -> ${b.recommended ? `use ${b.recommended.tier} (${b.recommended.model})` : `no candidate clears ${pct(threshold)} (lower bound)`}`);
      }
      return;
    }
    case "report": {
      const { calls, anonReport } = load(a);
      let ledger: DecisionRecord[] | undefined;
      if (flag(a, "ledger")) ledger = readFileSync(flag(a, "ledger")!, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
      const invoice = flag(a, "invoice-usd") ? { billedUsd: Number(flag(a, "invoice-usd")) } : undefined;
      const report = await buildEvidenceReportFromCalls(calls, { title: flag(a, "title"), anonymization: anonReport, ledger, invoice });
      const t = report.totals;
      console.log(`Savings ${pct(t.savedPct)} (${usd(t.savedUsd)} of ${usd(t.baselineUsd)}) — headline tier: ${TIER_INFO[t.headlineTier].label}; evidence-backed ${pct(t.evidenceBackedShare)}; modeled-only would claim ${pct(t.modeledSavedPct)}`);
      if (flag(a, "html")) writeFileSync(flag(a, "html")!, renderHtml(report));
      if (flag(a, "pdf")) writeFileSync(flag(a, "pdf")!, await renderPdf(report));
      if (flag(a, "badge")) writeFileSync(flag(a, "badge")!, badgeForReport(report));
      for (const k of ["html", "pdf", "badge"]) if (flag(a, k)) console.log(`Wrote ${flag(a, k)}`);
      return;
    }
    default:
      console.log(USAGE);
      if (cmd) process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
