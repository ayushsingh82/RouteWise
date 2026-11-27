import { TIER_INFO, TIER_ORDER, type EvidenceReport, type EvidenceTier } from "./evidence";
import { badgeForReport } from "./badge";

const esc = (s: unknown) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const usd = (n: number) => (Math.abs(n) >= 100 ? `$${n.toFixed(0)}` : Math.abs(n) >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(4)}`);
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

const TIER_COLOR: Record<EvidenceTier, string> = { modeled: "#b68a1a", benchmarked: "#2f7f8f", replayed: "#2d7ff9", measured: "#2e9e5b", verified: "#1b8a3e" };

function tierPill(t: EvidenceTier): string {
  return `<span class="pill" style="--c:${TIER_COLOR[t]}">${esc(TIER_INFO[t].label)}</span>`;
}

function beforeAfterSvg(report: EvidenceReport): string {
  const rows = report.tasks.filter((t) => t.currentUsd > 0).slice(0, 8);
  if (rows.length === 0) return "";
  const max = Math.max(...rows.map((r) => r.currentUsd));
  const rowH = 30;
  const left = 150;
  const width = 560;
  const barW = width - left - 90;
  const h = rows.length * rowH + 24;
  const bars = rows
    .map((r, i) => {
      const y = i * rowH + 20;
      const bw = Math.max(1, (r.currentUsd / max) * barW);
      const aw = Math.max(0, ((r.currentUsd - r.savedUsd) / max) * barW);
      return `<text x="0" y="${y + 11}" font-size="11" fill="currentColor">${esc(r.name.length > 22 ? `${r.name.slice(0, 21)}…` : r.name)}</text>
<rect x="${left}" y="${y}" width="${bw}" height="9" rx="2" fill="#8a8a8a" opacity=".45"/>
<rect x="${left}" y="${y + 11}" width="${aw}" height="9" rx="2" fill="${TIER_COLOR[r.tier]}"/>
<text x="${left + bw + 6}" y="${y + 8}" font-size="10" fill="currentColor" opacity=".7">${usd(r.currentUsd)}</text>
<text x="${left + Math.max(aw, 0) + 6}" y="${y + 19}" font-size="10" fill="currentColor">${usd(r.currentUsd - r.savedUsd)}</text>`;
    })
    .join("\n");
  return `<svg viewBox="0 0 ${width} ${h}" width="100%" role="img" aria-label="Spend before and after routing, per task"><text x="${left}" y="11" font-size="10" fill="currentColor" opacity=".6">grey = today · colour = after routing (colour = evidence tier)</text>${bars}</svg>`;
}

/** A self-contained, printable HTML report (no external assets). Use the browser's "Save as PDF" or `renderPdf` for a PDF. */
export function renderHtml(report: EvidenceReport): string {
  const t = report.totals;
  const tierRows = TIER_ORDER.filter((k) => t.byTier[k] > 0)
    .map((k) => `<tr><td>${tierPill(k)}</td><td class="num">${usd(t.byTier[k])}</td><td class="num">${t.savedUsd > 0 ? pct(t.byTier[k] / t.savedUsd) : "—"}</td><td class="muted">${esc(TIER_INFO[k].description)}</td></tr>`)
    .join("");
  const tierBar = TIER_ORDER.filter((k) => t.byTier[k] > 0 && t.savedUsd > 0)
    .map((k) => `<div style="width:${((t.byTier[k] / t.savedUsd) * 100).toFixed(2)}%;background:${TIER_COLOR[k]}" title="${esc(TIER_INFO[k].label)}: ${usd(t.byTier[k])}"></div>`)
    .join("");
  const taskRows = report.tasks
    .map(
      (r) => `<tr>
<td><strong>${esc(r.name)}</strong><div class="muted small">${esc(r.classification)}${r.callCount ? ` · ${r.callCount} calls` : ""}</div></td>
<td class="num">${usd(r.currentUsd)}</td><td class="num">${usd(r.currentUsd - r.savedUsd)}</td>
<td class="num"><strong>${pct(r.savedPct)}</strong>${Math.abs(r.modeledPct - r.savedPct) > 0.0005 ? `<div class="muted small">modeled ${pct(r.modeledPct)}</div>` : ""}</td>
<td>${tierPill(r.tier)}</td>
<td class="small">${esc(r.basis)}${r.caveats.map((c) => `<div class="muted">⚠ ${esc(c)}</div>`).join("")}</td></tr>`,
    )
    .join("");
  const inv = report.invoice
    ? `<section><h2>Invoice reconciliation</h2><p>Ledger actual spend ${usd(report.invoice.ledgerActualUsd)} vs. billed ${usd(report.invoice.billedUsd)}${report.invoice.periodLabel ? ` (${esc(report.invoice.periodLabel)})` : ""}: ${pct(report.invoice.deltaPct)} difference — ${report.invoice.matched ? "<strong>within</strong>" : "<strong>outside</strong>"} the ${pct(report.invoice.tolerance)} tolerance.</p></section>`
    : "";
  const anon = report.anonymization
    ? `<p class="small muted">Trace anonymized before analysis: ${report.anonymization.total} sensitive values replaced (${Object.entries(report.anonymization.byCategory).map(([k, v]) => `${esc(k.toLowerCase())} ${v}`).join(", ")}).</p>`
    : "";

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Savings report — ${esc(report.title)}</title>
<style>
:root{color-scheme:light dark;--bg:#fff;--fg:#16181d;--muted:#656b76;--line:#e3e5ea;--card:#f6f7f9}
@media (prefers-color-scheme:dark){:root{--bg:#0e1013;--fg:#e8eaee;--muted:#9aa1ad;--line:#262a31;--card:#161a20}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}
main{max-width:920px;margin:0 auto;padding:40px 24px 64px}h1{font-size:26px;margin:0 0 4px}h2{font-size:17px;margin:36px 0 10px}
.muted{color:var(--muted)}.small{font-size:12.5px}.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.hero{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin:22px 0}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px}.card b{display:block;font-size:26px;font-variant-numeric:tabular-nums}
table{width:100%;border-collapse:collapse}th,td{padding:9px 8px;border-bottom:1px solid var(--line);vertical-align:top;text-align:left}th{font-size:11.5px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}
.pill{display:inline-block;padding:1px 9px;border-radius:99px;font-size:12px;font-weight:600;color:var(--c);border:1px solid var(--c);white-space:nowrap}
.tierbar{display:flex;height:12px;border-radius:99px;overflow:hidden;background:var(--line);margin:10px 0 14px}
ul{padding-left:20px}li{margin:3px 0}.badge{margin-top:10px}
@media print{body{font-size:12px}main{padding:0}.card,tr{break-inside:avoid}h2{break-after:avoid}}
@media (max-width:640px){th:nth-child(6),td:nth-child(6){display:none}}
</style></head><body><main>
<h1>Savings report</h1>
<div class="muted">${esc(report.title)} · generated ${esc(report.generatedAt.slice(0, 10))}</div>
<div class="muted small">${esc(report.sourceSummary)}</div>
<div class="badge">${badgeForReport(report)}</div>

<div class="hero">
<div class="card"><span class="muted small">Spend today</span><b>${usd(t.baselineUsd)}</b></div>
<div class="card"><span class="muted small">After routing</span><b>${usd(t.baselineUsd - t.savedUsd)}</b></div>
<div class="card"><span class="muted small">Claimed savings</span><b>${pct(t.savedPct)}</b><span class="muted small">${usd(t.savedUsd)} · mostly ${esc(TIER_INFO[t.headlineTier].label.toLowerCase())}</span></div>
<div class="card"><span class="muted small">Evidence-backed share</span><b>${pct(t.evidenceBackedShare)}</b><span class="muted small">of savings replayed or better</span></div>
</div>
${t.modeledSavedPct > t.savedPct + 0.005 ? `<p class="muted small">A purely modeled estimate would have claimed ${pct(t.modeledSavedPct)}; the evidence-adjusted figure above is lower because replay on real traffic found less.</p>` : ""}

<h2>How much of this is proven?</h2>
<div class="tierbar">${tierBar}</div>
<table><thead><tr><th>Evidence tier</th><th class="num">Savings</th><th class="num">Share</th><th>What it means</th></tr></thead><tbody>${tierRows || `<tr><td colspan="4" class="muted">No savings found.</td></tr>`}</tbody></table>

<h2>Spend before and after, per task</h2>
${beforeAfterSvg(report)}

<h2>Per-task evidence</h2>
<table><thead><tr><th>Task</th><th class="num">Today</th><th class="num">After</th><th class="num">Saved</th><th>Tier</th><th>Basis</th></tr></thead><tbody>${taskRows}</tbody></table>
${inv}
${report.caveats.length ? `<h2>Caveats</h2><ul>${report.caveats.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>` : ""}
<h2>Assumptions</h2><ul class="small">${report.assumptions.map((a) => `<li>${esc(a)}</li>`).join("")}</ul>
${anon}
<h2>Method</h2>
<p class="small muted">Each task is classified from its prompt and from statistics of its recorded calls (repeat-input rate, output consistency). The routing policy is then replayed in chronological order over the recorded calls — learning only from earlier calls — and each cache hit or downgrade is compared with the answer the model actually gave. Savings are tagged with the strongest evidence that supports them; the headline tier is the strongest tier that still covers at least half of the claimed dollars.</p>
</main></body></html>`;
}
