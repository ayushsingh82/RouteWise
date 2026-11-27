"use client";

import { TIER_COLOR, TIER_INFO } from "@/lib/report/tiers";
import { EmptyState } from "./empty-state";
import { timeAgo, type HistoryEntry } from "./history";

export function HistoryList({ entries, onOpen, onRemove, onClear }: { entries: HistoryEntry[]; onOpen: (e: HistoryEntry) => void; onRemove: (id: string) => void; onClear: () => void }) {
  return (
    <section aria-labelledby="history-h">
      <div className="mb-2 flex items-center justify-between">
        <h2 id="history-h" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Trace history</h2>
        {entries.length > 0 && (
          <button onClick={onClear} className="text-xs text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200">Clear all</button>
        )}
      </div>
      {entries.length === 0 ? (
        <EmptyState title="No analyses yet" icon="⏱">
          Each trace you analyze is listed here with its savings and evidence tier. History lives only in this browser; uploaded traces are never stored.
        </EmptyState>
      ) : (
        <ul className="divide-y divide-black/5 overflow-hidden rounded-xl border border-black/10 dark:divide-white/5 dark:border-white/10">
          {entries.map((e) => (
            <li key={e.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="size-2 shrink-0 rounded-full" style={{ background: TIER_COLOR[e.tier] }} title={TIER_INFO[e.tier].label} />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-zinc-900 dark:text-zinc-100">{`${e.reopen?.kind === "sample" ? "Sample" : e.reopen ? "Workflow" : "Upload"} · ${e.label}`}</div>
                <div className="text-xs text-zinc-500 dark:text-zinc-400">
                  {e.tasks} task{e.tasks === 1 ? "" : "s"} · {TIER_INFO[e.tier].label.toLowerCase()} · {timeAgo(e.ts)}
                </div>
              </div>
              <div className="tabular-nums text-sm font-semibold text-zinc-900 dark:text-zinc-100">{(e.savedPct * 100).toFixed(1)}%</div>
              {e.reopen ? (
                <button onClick={() => onOpen(e)} className="rounded-md px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-black/5 dark:text-zinc-300 dark:hover:bg-white/10">Open</button>
              ) : (
                <span className="px-2 text-xs text-zinc-400" title="Uploaded traces aren't stored. Re-upload the file to open it again.">upload</span>
              )}
              <button onClick={() => onRemove(e.id)} aria-label={`Remove ${e.label} from history`} className="rounded-md px-1.5 py-1 text-xs text-zinc-400 hover:text-rose-600">✕</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
