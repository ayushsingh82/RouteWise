import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { TIER_INFO, TIER_ORDER, type EvidenceReport, type EvidenceTier } from "./evidence";

const usd = (n: number) => (Math.abs(n) >= 100 ? `$${n.toFixed(0)}` : Math.abs(n) >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(4)}`);
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const COLORS: Record<EvidenceTier, [number, number, number]> = {
  modeled: [0.71, 0.54, 0.1],
  benchmarked: [0.18, 0.5, 0.56],
  replayed: [0.18, 0.5, 0.98],
  measured: [0.18, 0.62, 0.36],
  verified: [0.11, 0.54, 0.24],
};

// pdf-lib's standard fonts are WinAnsi-only: swap the few non-Latin-1 glyphs we emit and drop the rest.
const clean = (s: string) => s.replace(/[→]/g, "->").replace(/[·•]/g, "-").replace(/[—–]/g, "-").replace(/[…]/g, "...").replace(/[⚠]/g, "!").replace(/[^\x20-\x7e\xa0-\xff]/g, "?");

function wrap(text: string, font: PDFFont, size: number, maxW: number): string[] {
  const words = clean(text).split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(next, size) > maxW && cur) {
      lines.push(cur);
      cur = w;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}

/** Renders the evidence report as a self-contained PDF (no browser needed). */
export async function renderPdf(report: EvidenceReport): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Savings report - ${clean(report.title)}`);
  doc.setCreator("RouteWise");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 595, H = 842, M = 48;
  let page: PDFPage = doc.addPage([W, H]);
  let y = H - M;

  const ink = rgb(0.09, 0.1, 0.12);
  const grey = rgb(0.4, 0.42, 0.46);
  const line = rgb(0.88, 0.89, 0.91);

  const ensure = (need: number) => {
    if (y - need < M) {
      page = doc.addPage([W, H]);
      y = H - M;
    }
  };
  const text = (s: string, o: { size?: number; f?: PDFFont; color?: ReturnType<typeof rgb>; x?: number } = {}) => {
    page.drawText(clean(s), { x: o.x ?? M, y, size: o.size ?? 10, font: o.f ?? font, color: o.color ?? ink });
  };
  const para = (s: string, o: { size?: number; f?: PDFFont; color?: ReturnType<typeof rgb>; indent?: number } = {}) => {
    const size = o.size ?? 10;
    for (const l of wrap(s, o.f ?? font, size, W - 2 * M - (o.indent ?? 0))) {
      ensure(size + 4);
      y -= size + 3;
      text(l, { ...o, x: M + (o.indent ?? 0) });
    }
  };
  const h2 = (s: string) => {
    ensure(40);
    y -= 26;
    text(s, { size: 13, f: bold });
    y -= 4;
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.6, color: line });
  };

  const t = report.totals;
  y -= 8;
  text("Savings report", { size: 22, f: bold });
  y -= 18;
  text(report.title, { size: 11, color: grey });
  y -= 13;
  text(`Generated ${report.generatedAt.slice(0, 10)}`, { size: 9, color: grey });
  if (report.sourceSummary) para(report.sourceSummary, { size: 9, color: grey });

  // headline cards
  y -= 22;
  const cards: [string, string][] = [
    ["Spend today", usd(t.baselineUsd)],
    ["After routing", usd(t.baselineUsd - t.savedUsd)],
    ["Claimed savings", pct(t.savedPct)],
    ["Evidence-backed", pct(t.evidenceBackedShare)],
  ];
  const cw = (W - 2 * M - 3 * 10) / 4;
  cards.forEach(([label, value], i) => {
    const x = M + i * (cw + 10);
    page.drawRectangle({ x, y: y - 46, width: cw, height: 52, borderColor: line, borderWidth: 0.8, color: rgb(0.97, 0.97, 0.98) });
    page.drawText(clean(label), { x: x + 8, y: y - 12, size: 8, font, color: grey });
    page.drawText(clean(value), { x: x + 8, y: y - 34, size: 17, font: bold, color: ink });
  });
  y -= 56;
  para(`Headline tier: ${TIER_INFO[t.headlineTier].label} - the strongest evidence tier that still covers at least half of the claimed dollars.${t.modeledSavedPct > t.savedPct + 0.005 ? ` A purely modeled estimate would have claimed ${pct(t.modeledSavedPct)}.` : ""}`, { size: 9, color: grey });

  h2("How much of this is proven?");
  y -= 8;
  const barW = W - 2 * M;
  let bx = M;
  for (const k of TIER_ORDER) {
    if (t.byTier[k] <= 0 || t.savedUsd <= 0) continue;
    const w = (t.byTier[k] / t.savedUsd) * barW;
    page.drawRectangle({ x: bx, y: y - 10, width: w, height: 10, color: rgb(...COLORS[k]) });
    bx += w;
  }
  y -= 14;
  for (const k of TIER_ORDER) {
    if (t.byTier[k] <= 0) continue;
    ensure(30);
    y -= 14;
    page.drawRectangle({ x: M, y: y - 1, width: 7, height: 7, color: rgb(...COLORS[k]) });
    text(`${TIER_INFO[k].label}   ${usd(t.byTier[k])}  (${pct(t.byTier[k] / t.savedUsd)})`, { size: 10, f: bold, x: M + 12 });
    para(TIER_INFO[k].description, { size: 8.5, color: grey, indent: 12 });
  }

  h2("Per-task evidence");
  const cols = [M, M + 150, M + 215, M + 280, M + 335];
  y -= 14;
  ["Task", "Today", "After", "Saved", "Tier"].forEach((hd, i) => text(hd, { size: 8, f: bold, color: grey, x: cols[i] }));
  for (const r of report.tasks) {
    const basis = wrap(`${r.basis}${r.caveats.length ? ` (!) ${r.caveats[0]}` : ""}`, font, 8, W - 2 * M);
    ensure(24 + basis.length * 11);
    y -= 16;
    text(r.name.length > 26 ? `${r.name.slice(0, 25)}...` : r.name, { size: 9.5, f: bold });
    text(usd(r.currentUsd), { size: 9.5, x: cols[1] });
    text(usd(r.currentUsd - r.savedUsd), { size: 9.5, x: cols[2] });
    text(pct(r.savedPct), { size: 9.5, f: bold, x: cols[3] });
    text(TIER_INFO[r.tier].label, { size: 9.5, color: rgb(...COLORS[r.tier]), f: bold, x: cols[4] });
    for (const l of basis) {
      y -= 11;
      text(l, { size: 8, color: grey });
    }
    page.drawLine({ start: { x: M, y: y - 5 }, end: { x: W - M, y: y - 5 }, thickness: 0.4, color: line });
    y -= 4;
  }

  if (report.invoice) {
    h2("Invoice reconciliation");
    para(`Ledger actual spend ${usd(report.invoice.ledgerActualUsd)} vs. billed ${usd(report.invoice.billedUsd)}: ${pct(report.invoice.deltaPct)} difference - ${report.invoice.matched ? "within" : "outside"} the ${pct(report.invoice.tolerance)} tolerance.`);
  }
  if (report.caveats.length) {
    h2("Caveats");
    for (const c of report.caveats) para(`- ${c}`, { size: 9.5 });
  }
  h2("Assumptions");
  for (const a of report.assumptions) para(`- ${a}`, { size: 9 });
  if (report.anonymization) {
    y -= 6;
    para(`Trace anonymized before analysis: ${report.anonymization.total} sensitive values replaced.`, { size: 8.5, color: grey });
  }
  return doc.save();
}
