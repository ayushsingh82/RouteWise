"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useSyncExternalStore, type ChangeEvent } from "react";
import type { StepClassification, ClassificationSummary } from "@/lib/workflow/classify";
import type { RoutingDecision, RoutingDistribution } from "@/lib/workflow/router";
import type { WorkflowHealthReport } from "@/lib/workflow/health";
import type { TraceSavingsReport } from "@/lib/workflow/savings";
import type { EvidenceReport } from "@/lib/report/evidence";
import { ErrorBoundary } from "./_components/error-boundary";
import { EmptyState } from "./_components/empty-state";
import { EvidencePanel, type ReportSourceRef } from "./_components/evidence-panel";
import { HistoryList } from "./_components/history-list";
import { addHistory, clearHistory, historyStore, parseHistory, removeHistory, type HistoryEntry } from "./_components/history";
import { FIXTURE_LABELS, SAMPLE_LABELS } from "./_components/catalog";

interface AnalyzeResponse {
  traceId: string;
  traceName: string;
  traceDescription?: string;
  fixtures: string[];
  modelFallback: { requested: boolean; used: boolean; apiKeyConfigured: boolean };
  classifications: StepClassification[];
  classificationSummary: ClassificationSummary;
  routing: RoutingDecision[];
  routingSummary: RoutingDistribution;
  health: WorkflowHealthReport;
  savings: TraceSavingsReport;
  /** Evidence-tiered report. Optional so older/partial responses still render. */
  evidence?: EvidenceReport;
  ingest?: { format?: string; calls: number; models: string[] } | null;
}

function isAnalyzeResponse(v: unknown): v is AnalyzeResponse {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.traceName === "string" &&
    Array.isArray(o.classifications) &&
    Array.isArray(o.routing) &&
    typeof o.routingSummary === "object" && o.routingSummary !== null &&
    typeof o.health === "object" && o.health !== null &&
    typeof o.savings === "object" && o.savings !== null &&
    typeof o.modelFallback === "object" && o.modelFallback !== null
  );
}

type Source =
  | { kind: "fixture"; fixture: string }
  | { kind: "sample"; id: string }
  | { kind: "custom"; trace: unknown; fileName: string }
  | { kind: "raw"; text: string; fileName: string };

type FetchState = { status: "loading" } | { status: "error"; message: string } | { status: "done"; data: AnalyzeResponse };

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024; // hosted serverless request-body ceiling is ~4.5 MB

const CLASSIFICATION_STYLES: Record<string, string> = {
  deterministic: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 ring-emerald-500/20",
  cacheable: "bg-sky-500/10 text-sky-700 dark:text-sky-400 ring-sky-500/20",
  "simple-judgment": "bg-amber-500/10 text-amber-700 dark:text-amber-400 ring-amber-500/20",
  "complex-judgment": "bg-rose-500/10 text-rose-700 dark:text-rose-400 ring-rose-500/20",
};

function usd(n: number): string {
  return `$${n.toFixed(4)}`;
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-white/[.03]">
      <div className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-zinc-950 dark:text-zinc-50">{value}</div>
      {sub && <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{sub}</div>}
    </div>
  );
}

function sourceLabel(s: Source): string {
  switch (s.kind) {
    case "fixture": return FIXTURE_LABELS[s.fixture] ?? s.fixture;
    case "sample": return SAMPLE_LABELS[s.id] ?? s.id;
    default: return s.fileName;
  }
}

/**
 * Owns its own fetch/loading/error state for one (source, modelFallback)
 * pair. The parent remounts this via a `key` change instead of resetting
 * state imperatively, so every setState call here happens inside a .then/
 * .catch callback (an async response to the fetch) rather than synchronously
 * in the effect body.
 */
function AnalysisResults({ source, modelFallback, onLoaded }: { source: Source; modelFallback: boolean; onLoaded: (data: AnalyzeResponse) => void }) {
  const [state, setState] = useState<FetchState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    const post = (payload: Record<string, unknown>) =>
      fetch("/api/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, modelFallback }) });
    const request =
      source.kind === "fixture"
        ? fetch(`/api/analyze?fixture=${encodeURIComponent(source.fixture)}&modelFallback=${modelFallback}`)
        : source.kind === "sample"
          ? fetch(`/api/analyze?sample=${encodeURIComponent(source.id)}&modelFallback=${modelFallback}`)
          : source.kind === "raw"
            ? post({ raw: source.text, fileName: source.fileName.replace(/\.[^.]+$/, "") })
            : post({ trace: source.trace });

    request
      .then(async (res) => {
        let json: unknown;
        try {
          json = await res.json();
        } catch {
          throw new Error(`The server returned an unreadable response (HTTP ${res.status}).`);
        }
        if (!res.ok) {
          const msg = (json as { error?: unknown } | null)?.error;
          throw new Error(typeof msg === "string" ? msg : `Request failed (${res.status})`);
        }
        if (!isAnalyzeResponse(json)) throw new Error("The analysis response was missing expected fields.");
        return json;
      })
      .then((json) => {
        if (cancelled) return;
        setState({ status: "done", data: json });
        try {
          onLoaded(json);
        } catch {
          /* history is a convenience: failing to record an entry must never fail the analysis */
        }
      })
      .catch((err) => {
        if (!cancelled) setState({ status: "error", message: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      cancelled = true;
    };
    // onLoaded is intentionally excluded: it is a fresh closure each render and must not retrigger the fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, modelFallback]);

  if (state.status === "loading") {
    return <div className="text-sm text-zinc-500 dark:text-zinc-400">Analyzing…</div>;
  }

  if (state.status === "error") {
    return (
      <div role="alert" className="rounded-xl border border-rose-500/30 bg-rose-500/5 px-4 py-3 text-sm text-rose-700 dark:text-rose-400">
        {state.message}
      </div>
    );
  }

  const data = state.data;
  const sourceRef: ReportSourceRef =
    source.kind === "fixture"
      ? { kind: "fixture", fixture: source.fixture }
      : source.kind === "sample"
        ? { kind: "sample", id: source.id }
        : { kind: "upload", post: () => (source.kind === "raw" ? { raw: source.text, fileName: source.fileName.replace(/\.[^.]+$/, "") } : { trace: source.trace }) };

  return (
    <>
      {data.modelFallback.requested && !data.modelFallback.used && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
          Claude fallback requested but ANTHROPIC_API_KEY isn&apos;t configured on the server — showing rules-only classification.
        </div>
      )}

      <p className="text-sm text-zinc-500 dark:text-zinc-400">{data.traceDescription}</p>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Naive frontier baseline" value={usd(data.savings.totals.naiveFrontierUsd)} />
        <StatCard label="Current spend" value={usd(data.savings.totals.currentUsd)} />
        <StatCard label="Recommended spend" value={usd(data.savings.totals.recommendedUsd)} />
        <StatCard
          label="Savings vs. naive"
          value={pct(data.savings.totals.savingsVsNaiveFrontierPct)}
          sub={usd(data.savings.totals.savingsVsNaiveFrontierUsd) + " saved"}
        />
      </section>

      {data.evidence && <EvidencePanel report={data.evidence} sourceRef={sourceRef} ingest={data.ingest ?? null} />}

      <section
        className={`rounded-xl border px-4 py-3 text-sm ${
          data.health.isDecompositionCandidate
            ? "border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-400"
            : "border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400"
        }`}
      >
        <div className="font-medium">{data.health.isDecompositionCandidate ? "Decomposition candidate" : "Workflow health OK"}</div>
        {data.health.reasons.length > 0 && (
          <ul className="mt-1 list-inside list-disc space-y-0.5 opacity-90">
            {data.health.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">Routing split (share of calls that hit a model)</h2>
        <div className="flex h-3 overflow-hidden rounded-full bg-black/[.06] dark:bg-white/[.08]">
          {(["non-frontier", "near-frontier", "frontier"] as const).map((tier) => {
            const share = data.routingSummary.modelSharePct[tier];
            if (share <= 0) return null;
            const color = tier === "non-frontier" ? "bg-emerald-500" : tier === "near-frontier" ? "bg-amber-500" : "bg-rose-500";
            return <div key={tier} className={color} style={{ width: `${share * 100}%` }} title={`${tier}: ${pct(share)}`} />;
          })}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
          <span>🟢 non-frontier {pct(data.routingSummary.modelSharePct["non-frontier"])}</span>
          <span>🟡 near-frontier {pct(data.routingSummary.modelSharePct["near-frontier"])}</span>
          <span>🔴 frontier {pct(data.routingSummary.modelSharePct.frontier)}</span>
          <span>code={data.routingSummary.code}</span>
          <span>cache={data.routingSummary.cache}</span>
          <span>human={data.routingSummary.human}</span>
          <span>escalated={data.routingSummary.escalatedCount}</span>
        </div>
      </section>

      <section className="overflow-x-auto">
        <h2 className="mb-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">Step-by-step breakdown</h2>
        {data.savings.steps.length === 0 ? (
          <EmptyState title="No steps to show">This trace has no steps. Check that the file is a workflow trace or a supported tool export.</EmptyState>
        ) : (
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-black/10 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-white/10 dark:text-zinc-400">
                <th className="py-2 pr-4 font-medium">Step</th>
                <th className="py-2 pr-4 font-medium">Classification</th>
                <th className="py-2 pr-4 font-medium text-right">Naive</th>
                <th className="py-2 pr-4 font-medium text-right">Current</th>
                <th className="py-2 pr-4 font-medium text-right">Recommended</th>
              </tr>
            </thead>
            <tbody>
              {data.savings.steps.map((step) => (
                <tr key={step.stepId} className="border-b border-black/5 dark:border-white/5">
                  <td className="py-2 pr-4 font-mono text-xs text-zinc-800 dark:text-zinc-200">{step.stepId}</td>
                  <td className="py-2 pr-4">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${CLASSIFICATION_STYLES[step.classification]}`}>
                      {step.classification}
                    </span>
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums text-zinc-600 dark:text-zinc-400">{usd(step.naiveFrontierUsd)}</td>
                  <td className="py-2 pr-4 text-right tabular-nums text-zinc-600 dark:text-zinc-400">{usd(step.currentUsd)}</td>
                  <td className="py-2 pr-4 text-right tabular-nums font-medium text-zinc-950 dark:text-zinc-50">{usd(step.recommendedUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <footer className="text-xs text-zinc-500 dark:text-zinc-400">
        {source.kind === "fixture" ? (
          <>
            Also available as a CLI:{" "}
            <code className="rounded bg-black/[.06] px-1 py-0.5 font-mono dark:bg-white/[.08]">npm run analyze -- --fixture {source.fixture}</code>
          </>
        ) : source.kind === "sample" ? (
          <>
            Same analysis offline:{" "}
            <code className="rounded bg-black/[.06] px-1 py-0.5 font-mono dark:bg-white/[.08]">npm run rw -- report samples/{source.id}.* --anonymize --pdf report.pdf</code>
          </>
        ) : (
          <>Analyzed uploaded trace: {source.fileName}</>
        )}
      </footer>
    </>
  );
}

/** Decides what an uploaded file is: a workflow-trace JSON, or a raw tool export (JSON or JSONL). Returns an error message for neither. */
function classifyUpload(text: string, fileName: string): { source: Source } | { error: string } {
  if (new Blob([text]).size > MAX_UPLOAD_BYTES) {
    return { error: `"${fileName}" is over 4 MB, which is more than the hosted analyzer accepts. Run it locally instead: npm run rw -- report <file> --pdf report.pdf` };
  }
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) && Array.isArray((parsed as { steps?: unknown }).steps)) {
      return { source: { kind: "custom", trace: parsed, fileName } };
    }
    return { source: { kind: "raw", text, fileName } };
  } catch (err) {
    const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
    const isJsonl = lines.length > 1 && lines.every((l) => {
      try {
        JSON.parse(l);
        return true;
      } catch {
        return false;
      }
    });
    if (isJsonl) return { source: { kind: "raw", text, fileName } };
    return { error: `Could not parse "${fileName}" as JSON: ${err instanceof Error ? err.message : String(err)}` };
  }
}

export default function Dashboard() {
  const [source, setSource] = useState<Source>({ kind: "fixture", fixture: "ap-invoice" });
  const [modelFallback, setModelFallback] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);

  const rawHistory = useSyncExternalStore(historyStore.subscribe, historyStore.getSnapshot, historyStore.getServerSnapshot);
  const history = useMemo(() => parseHistory(rawHistory), [rawHistory]);

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file later
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const result = classifyUpload(String(reader.result), file.name);
      if ("error" in result) {
        setUploadError(result.error);
        return;
      }
      setUploadError(null);
      setSource(result.source);
    };
    reader.onerror = () => setUploadError(`Could not read "${file.name}".`);
    reader.readAsText(file);
  }

  function recordHistory(data: AnalyzeResponse) {
    const ev = data.evidence;
    addHistory({
      label: sourceLabel(source),
      tasks: ev?.tasks.length ?? data.savings.steps.length,
      baselineUsd: ev?.totals.baselineUsd ?? data.savings.totals.currentUsd,
      savedUsd: ev?.totals.savedUsd ?? data.savings.totals.savingsVsCurrentUsd,
      savedPct: ev?.totals.savedPct ?? data.savings.totals.savingsVsCurrentPct,
      tier: ev?.totals.headlineTier ?? "modeled",
      reopen: source.kind === "fixture" ? { kind: "fixture", fixture: source.fixture } : source.kind === "sample" ? { kind: "sample", id: source.id } : null,
    });
  }

  function openFromHistory(e: HistoryEntry) {
    if (!e.reopen) return;
    setUploadError(null);
    setSource(e.reopen.kind === "fixture" ? { kind: "fixture", fixture: e.reopen.fixture } : { kind: "sample", id: e.reopen.id });
  }

  const pill = (active: boolean) =>
    `rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
      active
        ? "bg-zinc-950 text-white dark:bg-zinc-50 dark:text-zinc-950"
        : "bg-black/[.04] text-zinc-700 hover:bg-black/[.08] dark:bg-white/[.06] dark:text-zinc-300 dark:hover:bg-white/[.1]"
    }`;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-6 py-12 sm:px-10">
      <header className="flex flex-col gap-2">
        <Link href="/" className="text-xs font-medium text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200">← RouteWise</Link>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">Savings dashboard</h1>
        <p className="max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
          Decomposes a workflow into steps, classifies each by how much intelligence it actually needs, and reports what
          you&apos;d save by routing every step to the cheapest resource that can reliably handle it — with every number tagged by how well it&apos;s proven.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-2">
          {Object.keys(FIXTURE_LABELS).map((key) => (
            <button key={key} onClick={() => setSource({ kind: "fixture", fixture: key })} className={pill(source.kind === "fixture" && source.fixture === key)}>
              {FIXTURE_LABELS[key]}
            </button>
          ))}
          <label className={`cursor-pointer ${pill(source.kind === "custom" || source.kind === "raw")}`}>
            {source.kind === "custom" || source.kind === "raw" ? `📄 ${source.fileName}` : "Upload trace…"}
            <input type="file" accept="application/json,.json,.jsonl,.ndjson" onChange={handleFileChange} className="hidden" />
          </label>
        </div>
        <label className="ml-auto flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
          <input type="checkbox" checked={modelFallback} onChange={(e) => setModelFallback(e.target.checked)} className="size-4 rounded" />
          Use Claude for unconfident steps
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
        <label htmlFor="sample-select" className="font-medium">Recorded-traffic sample</label>
        <select
          id="sample-select"
          value={source.kind === "sample" ? source.id : ""}
          onChange={(e) => e.target.value && setSource({ kind: "sample", id: e.target.value })}
          className="rounded-lg border border-black/10 bg-white px-2 py-1.5 text-sm text-zinc-900 dark:border-white/15 dark:bg-zinc-900 dark:text-zinc-100"
        >
          <option value="">Choose a sample…</option>
          {Object.entries(SAMPLE_LABELS).map(([id, label]) => (
            <option key={id} value={id}>{label}</option>
          ))}
        </select>
        <span className="text-xs text-zinc-500">Synthetic traffic in each tool&apos;s real export format, anonymized on the fly.</span>
      </div>

      {uploadError && (
        <div role="alert" className="rounded-xl border border-rose-500/30 bg-rose-500/5 px-4 py-3 text-sm text-rose-700 dark:text-rose-400">{uploadError}</div>
      )}

      <ErrorBoundary key={`${JSON.stringify(source).length}-${retryNonce}`} onRetry={() => setRetryNonce((n) => n + 1)} label="The analysis couldn't be displayed.">
        <AnalysisResults key={`${JSON.stringify(source)}|${modelFallback}|${retryNonce}`} source={source} modelFallback={modelFallback} onLoaded={recordHistory} />
      </ErrorBoundary>

      <HistoryList
        entries={history}
        onOpen={openFromHistory}
        onRemove={(id) => removeHistory(id)}
        onClear={() => clearHistory()}
      />

      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        Uploads accept a workflow-trace JSON or a raw export from LangSmith, OpenTelemetry/OpenInference, Claude Code, Codex, or OpenAI logs (.json / .jsonl, up to 4 MB). Raw exports are anonymized (emails, keys, phone numbers, card numbers, IPs, paths) before analysis and are never stored.
      </p>
    </div>
  );
}
