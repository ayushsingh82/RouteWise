import { TIER_COLOR, TIER_INFO, type EvidenceTier } from "@/lib/report/tiers";

export interface CostRow {
  name: string;
  currentUsd: number;
  savedUsd: number;
  tier: EvidenceTier;
}

const usd = (n: number) => (n >= 100 ? `$${n.toFixed(0)}` : n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(4)}`);

/**
 * Before/after cost chart: for every task, a grey bar for what it costs today
 * and a coloured bar for what it costs after routing, coloured by the
 * evidence tier backing the saving. A total row leads. Pure SVG, no chart lib.
 */
export function CostChart({ rows, maxRows = 8 }: { rows: CostRow[]; maxRows?: number }) {
  const shown = rows.filter((r) => r.currentUsd > 0).slice(0, maxRows);
  const totalBefore = rows.reduce((s, r) => s + r.currentUsd, 0);
  const totalAfter = rows.reduce((s, r) => s + (r.currentUsd - r.savedUsd), 0);
  if (shown.length === 0 || totalBefore <= 0) return null;

  const all = [{ name: "All tasks", currentUsd: totalBefore, savedUsd: totalBefore - totalAfter, tier: undefined as EvidenceTier | undefined, total: true }, ...shown.map((r) => ({ ...r, total: false }))];
  const max = Math.max(...all.map((r) => r.currentUsd));
  const left = 168;
  const width = 720;
  const track = width - left - 84;
  const rowH = 38;
  const height = all.length * rowH + 8;
  const summary = `Spend before and after routing: ${usd(totalBefore)} today, ${usd(totalAfter)} after, across ${shown.length} tasks.`;

  return (
    <figure>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={summary} className="w-full text-zinc-700 dark:text-zinc-300">
        <title>{summary}</title>
        {all.map((r, i) => {
          const y = i * rowH + 4;
          const before = Math.max(2, (r.currentUsd / max) * track);
          const afterUsd = r.currentUsd - r.savedUsd;
          const after = Math.max(afterUsd > 0 ? 2 : 0, (afterUsd / max) * track);
          const color = r.tier ? TIER_COLOR[r.tier] : "#10b981";
          return (
            <g key={r.name}>
              <text x={0} y={y + 20} fontSize={r.total ? 13 : 12} fontWeight={r.total ? 600 : 400} fill="currentColor">
                {r.name.length > 24 ? `${r.name.slice(0, 23)}…` : r.name}
              </text>
              <rect x={left} y={y + 4} width={before} height={11} rx={3} fill="currentColor" opacity={0.2} />
              <rect x={left} y={y + 18} width={after} height={11} rx={3} fill={color} />
              <text x={left + before + 6} y={y + 14} fontSize={11} fill="currentColor" opacity={0.65}>{usd(r.currentUsd)}</text>
              <text x={left + after + 6} y={y + 28} fontSize={11} fontWeight={600} fill="currentColor">{usd(afterUsd)}</text>
            </g>
          );
        })}
      </svg>
      <figcaption className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
        <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-4 rounded-sm bg-current opacity-25" />today</span>
        {(Object.keys(TIER_INFO) as EvidenceTier[]).filter((t) => shown.some((r) => r.tier === t && r.savedUsd > 0)).map((t) => (
          <span key={t} className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-4 rounded-sm" style={{ background: TIER_COLOR[t] }} />after · {TIER_INFO[t].label.toLowerCase()}</span>
        ))}
      </figcaption>
    </figure>
  );
}
