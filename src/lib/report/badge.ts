import { TIER_INFO, type EvidenceReport, type EvidenceTier } from "./evidence";

/**
 * Shields-style SVG "savings badge" for READMEs. It always states the
 * evidence tier next to the number, so a modeled estimate can't masquerade as
 * a measured result: "tokens saved | 63% · modeled".
 */

const TIER_COLOR: Record<EvidenceTier, string> = {
  modeled: "#9a7b1c",
  benchmarked: "#2f7f8f",
  replayed: "#2d7ff9",
  measured: "#2e9e5b",
  verified: "#1b8a3e",
};

// Approximate Verdana 11px advance widths — good enough for a badge, no font metrics needed.
function textWidth(s: string): number {
  let w = 0;
  for (const ch of s) w += /[A-Z0-9%·]/.test(ch) ? 7.4 : /[ilI.,:;|!']/.test(ch) ? 3.4 : /[mwMW]/.test(ch) ? 10 : 6.2;
  return Math.ceil(w);
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function renderBadge(input: { pct: number; tier: EvidenceTier; label?: string }): string {
  const label = input.label ?? "tokens saved";
  const value = `${Math.round(input.pct * 100)}% · ${TIER_INFO[input.tier].label.toLowerCase()}`;
  const lw = textWidth(label) + 14;
  const vw = textWidth(value) + 14;
  const w = lw + vw;
  const color = input.pct <= 0 ? "#6b6b6b" : TIER_COLOR[input.tier];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="20" role="img" aria-label="${esc(label)}: ${esc(value)}">
<title>${esc(label)}: ${esc(value)}</title>
<linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>
<clipPath id="r"><rect width="${w}" height="20" rx="3" fill="#fff"/></clipPath>
<g clip-path="url(#r)"><rect width="${lw}" height="20" fill="#3a3a3a"/><rect x="${lw}" width="${vw}" height="20" fill="${color}"/><rect width="${w}" height="20" fill="url(#s)"/></g>
<g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
<text x="${lw / 2}" y="14">${esc(label)}</text><text x="${lw + vw / 2}" y="14">${esc(value)}</text></g></svg>`;
}

export function badgeForReport(report: EvidenceReport, label?: string): string {
  return renderBadge({ pct: report.totals.savedPct, tier: report.totals.headlineTier, label });
}

/** Markdown to paste into a README. `url` is where the badge SVG is served or committed. */
export function badgeMarkdown(url: string, reportUrl?: string): string {
  const img = `![tokens saved](${url})`;
  return reportUrl ? `[${img}](${reportUrl})` : img;
}
