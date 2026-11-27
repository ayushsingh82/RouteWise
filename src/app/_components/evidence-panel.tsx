"use client";

import { useState } from "react";
import type { EvidenceReport } from "@/lib/report/evidence";
import { TIER_COLOR, TIER_INFO, TIER_ORDER, type EvidenceTier } from "@/lib/report/tiers";
import { EmptyState } from "./empty-state";
import { CostChart } from "./cost-chart";

const usd = (n: number) => (n >= 100 ? `$${n.toFixed(0)}` : n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(4)}`);
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

export function TierPill({ tier }: { tier: EvidenceTier }) {
  return (
    <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold whitespace-nowrap" style={{ color: TIER_COLOR[tier], borderColor: TIER_COLOR[tier] }} title={TIER_INFO[tier].description}>
      {TIER_INFO[tier].label}
    </span>
  );
}

export type ReportSourceRef = { kind: "fixture"; fixture: string } | { kind: "sample"; id: string } | { kind: "upload"; post: () => Record<string, unknown> };

function reportUrl(ref: ReportSourceRef, format: string, download = false): string | null {
  if (ref.kind === "upload") return null;
  const q = ref.kind === "fixture" ? `fixture=${encodeURIComponent(ref.fixture)}` : `sample=${encodeURIComponent(ref.id)}`;
  return `/api/report?${q}&format=${format}${download ? "&download=1" : ""}`;
}

export function EvidencePanel({ report, sourceRef, ingest }: { report: EvidenceReport; sourceRef: ReportSourceRef; ingest: { format?: string; calls: number; models: string[] } | null }) {
  const t = report.totals;
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function download(format: "html" | "pdf" | "badge") {
    setBusy(format);
    setNote(null);
    try {
      const res = await fetch("/api/report", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...(sourceRef as Extract<ReportSourceRef, { kind: "upload" }>).post(), as: format }) });
      if (!res.ok) throw new Error(`Report failed (${res.status})`);
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `routewise-savings.${format === "badge" ? "svg" : format}`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function copyBadge() {
    const url = reportUrl(sourceRef, "badge");
    if (!url) return;
    const md = `[![tokens saved](${window.location.origin}${url})](${window.location.origin}/dashboard)`;
    try {
      await navigator.clipboard.writeText(md);
      setNote("README badge markdown copied.");
    } catch {
      setNote(md);
    }
  }

  const buttonCls = "rounded-lg border border-black/10 bg-white px-3 py-1.5 text-xs font-medium text-zinc-800 hover:bg-black/[.03] disabled:opacity-50 dark:border-white/15 dark:bg-white/[.04] dark:text-zinc-100 dark:hover:bg-white/10";
  const actions = (["html", "pdf"] as const).map((f) => {
    const href = reportUrl(sourceRef, f, true);
    return href ? (
      <a key={f} href={href} className={buttonCls}>Download {f.toUpperCase()}</a>
    ) : (
      <button key={f} onClick={() => download(f)} disabled={busy !== null} className={buttonCls}>{busy === f ? "Preparing…" : `Download ${f.toUpperCase()}`}</button>
    );
  });

  return (
    <section aria-labelledby="evidence-h" className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="evidence-h" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Savings by evidence tier</h2>
          <p className="mt-0.5 max-w-xl text-xs text-zinc-500 dark:text-zinc-400">
            Headline tier: <TierPill tier={t.headlineTier} /> · {pct(t.evidenceBackedShare)} of claimed savings are replayed or better
            {t.modeledSavedPct > t.savedPct + 0.005 ? ` · a modeled-only estimate would have claimed ${pct(t.modeledSavedPct)}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {actions}
          {reportUrl(sourceRef, "badge") ? (
            <button onClick={copyBadge} className={buttonCls}>Copy README badge</button>
          ) : (
            <button onClick={() => download("badge")} disabled={busy !== null} className={buttonCls}>{busy === "badge" ? "Preparing…" : "Download badge"}</button>
          )}
        </div>
      </div>
      {note && <div role="status" className="break-all rounded-lg bg-black/[.04] px-3 py-2 text-xs text-zinc-600 dark:bg-white/[.06] dark:text-zinc-300">{note}</div>}

      {t.savedUsd <= 0 ? (
        <EmptyState title="No savings found" icon="✓">
          Nothing here can be cheaper without risk: the tasks are either already lean or genuinely need a frontier model. That&apos;s a result, not an error.
        </EmptyState>
      ) : (
        <>
          <div>
            <div className="flex h-3 overflow-hidden rounded-full bg-black/[.06] dark:bg-white/[.08]" role="img" aria-label="Share of claimed savings by evidence tier">
              {TIER_ORDER.filter((k) => t.byTier[k] > 0).map((k) => (
                <div key={k} style={{ width: `${(t.byTier[k] / t.savedUsd) * 100}%`, background: TIER_COLOR[k] }} title={`${TIER_INFO[k].label}: ${usd(t.byTier[k])}`} />
              ))}
            </div>
            <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-zinc-600 dark:text-zinc-400">
              {TIER_ORDER.filter((k) => t.byTier[k] > 0).map((k) => (
                <li key={k} className="flex items-center gap-1.5">
                  <span className="inline-block size-2 rounded-full" style={{ background: TIER_COLOR[k] }} />
                  {TIER_INFO[k].label} {usd(t.byTier[k])} <span className="opacity-60">({pct(t.byTier[k] / t.savedUsd)})</span>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="mb-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">Cost before and after</h3>
            <CostChart rows={report.tasks.map((r) => ({ name: r.name, currentUsd: r.currentUsd, savedUsd: r.savedUsd, tier: r.tier }))} />
          </div>
        </>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-black/10 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-white/10 dark:text-zinc-400">
              <th className="py-2 pr-4 font-medium">Task</th>
              <th className="py-2 pr-4 text-right font-medium">Today</th>
              <th className="py-2 pr-4 text-right font-medium">Saved</th>
              <th className="py-2 pr-4 font-medium">Tier</th>
              <th className="py-2 font-medium">Basis</th>
            </tr>
          </thead>
          <tbody>
            {report.tasks.map((r) => (
              <tr key={r.stepId} className="border-b border-black/5 align-top dark:border-white/5">
                <td className="py-2 pr-4">
                  <div className="font-medium text-zinc-900 dark:text-zinc-100">{r.name}</div>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">{r.classification}{r.callCount ? ` · ${r.callCount} calls` : ""}</div>
                </td>
                <td className="py-2 pr-4 text-right tabular-nums text-zinc-600 dark:text-zinc-400">{usd(r.currentUsd)}</td>
                <td className="py-2 pr-4 text-right tabular-nums">
                  <span className="font-semibold text-zinc-900 dark:text-zinc-100">{pct(r.savedPct)}</span>
                  {Math.abs(r.modeledPct - r.savedPct) > 0.0005 && <div className="text-xs text-zinc-400">modeled {pct(r.modeledPct)}</div>}
                </td>
                <td className="py-2 pr-4"><TierPill tier={r.tier} /></td>
                <td className="py-2 text-xs text-zinc-600 dark:text-zinc-400">
                  {r.basis}
                  {r.caveats.map((c) => <div key={c} className="mt-0.5 text-zinc-400">⚠ {c}</div>)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(ingest || report.caveats.length > 0) && (
        <div className="space-y-1 text-xs text-zinc-500 dark:text-zinc-400">
          {ingest && (
            <p>
              Built from {ingest.calls} recorded calls ({ingest.format}; {ingest.models.join(", ")}).
              {report.anonymization ? ` Anonymized before analysis: ${report.anonymization.total} sensitive values replaced.` : ""}
            </p>
          )}
          {report.caveats.map((c) => <p key={c}>⚠ {c}</p>)}
        </div>
      )}
    </section>
  );
}
