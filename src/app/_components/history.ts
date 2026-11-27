/**
 * Trace history, kept only in this browser's localStorage. Entries hold
 * summary numbers and — for the built-in fixtures/samples — a way to reopen
 * them. Uploaded traces are never stored (they may be sensitive): their
 * entries are summaries only.
 */
import type { EvidenceTier } from "@/lib/report/tiers";

export type Reopenable = { kind: "fixture"; fixture: string } | { kind: "sample"; id: string };

export interface HistoryEntry {
  id: string;
  ts: number;
  label: string;
  tasks: number;
  baselineUsd: number;
  savedUsd: number;
  savedPct: number;
  tier: EvidenceTier;
  /** null for uploads: re-upload the file to view it again. */
  reopen: Reopenable | null;
}

const KEY = "routewise:history:v1";
const MAX = 20;

function valid(e: unknown): e is HistoryEntry {
  return typeof e === "object" && e !== null && typeof (e as HistoryEntry).id === "string" && typeof (e as HistoryEntry).ts === "number" && typeof (e as HistoryEntry).label === "string" && typeof (e as HistoryEntry).savedPct === "number";
}

export function parseHistory(raw: string | null): HistoryEntry[] {
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(valid) : [];
  } catch {
    return [];
  }
}

export function loadHistory(): HistoryEntry[] {
  return parseHistory(readRaw());
}

// --- external-store plumbing so components can read history with useSyncExternalStore (SSR-safe, no effect needed) ---
const EVENT = "routewise:history";

function readRaw(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export const historyStore = {
  subscribe(cb: () => void) {
    window.addEventListener(EVENT, cb);
    window.addEventListener("storage", cb);
    return () => {
      window.removeEventListener(EVENT, cb);
      window.removeEventListener("storage", cb);
    };
  },
  getSnapshot: readRaw,
  getServerSnapshot: (): string | null => null,
};

function save(entries: HistoryEntry[]): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(entries));
    window.dispatchEvent(new Event(EVENT));
  } catch {
    /* storage unavailable or full: history is a convenience, never required */
  }
}

/** Adds an entry (newest first). Re-analyzing the same source replaces its earlier entry instead of stacking duplicates. */
export function addHistory(entry: Omit<HistoryEntry, "id" | "ts">): HistoryEntry[] {
  const sameSource = (e: HistoryEntry) => e.label === entry.label && JSON.stringify(e.reopen) === JSON.stringify(entry.reopen);
  const next = [{ ...entry, id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, ts: Date.now() }, ...loadHistory().filter((e) => !sameSource(e))].slice(0, MAX);
  save(next);
  return next;
}

export function removeHistory(id: string): HistoryEntry[] {
  const next = loadHistory().filter((e) => e.id !== id);
  save(next);
  return next;
}

export function clearHistory(): HistoryEntry[] {
  save([]);
  return [];
}

export function timeAgo(ts: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
