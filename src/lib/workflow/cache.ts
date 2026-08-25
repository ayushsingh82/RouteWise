/**
 * Phase 3 — Caching layer. A minimal in-memory cache keyed on a normalized
 * input signature, with provenance so a stale or human-corrected entry can
 * be told apart from a fresh model output. Swappable for a real store
 * (Redis, a DB table) later — this defines the contract.
 */

export interface CacheEntry<T = unknown> {
  key: string;
  value: T;
  /** Where this value came from — a raw model output, or a human correction of one. */
  provenance: "model" | "human-corrected";
  createdAt: number;
  /** Optional expiry (ms epoch). Past this, treat as a miss even if present. */
  expiresAt?: number;
  hitCount: number;
}

export interface CacheLookup<T = unknown> {
  hit: boolean;
  entry?: CacheEntry<T>;
}

/**
 * Normalizes an input value into a cache key. Default: JSON-stable-stringify
 * of a lowercased/trimmed string, or JSON.stringify for non-strings. Callers
 * with task-specific notions of "same input" (e.g. fuzzy vendor-name match)
 * should pass their own keyFn to WorkflowCache instead of relying on this.
 */
export function defaultCacheKey(input: unknown): string {
  if (typeof input === "string") return input.trim().toLowerCase();
  return JSON.stringify(input);
}

export interface CacheStats {
  size: number;
  totalHits: number;
  totalLookups: number;
  hitRate: number;
}

export class WorkflowCache<T = unknown> {
  private store = new Map<string, CacheEntry<T>>();
  private totalLookups = 0;
  private totalHits = 0;

  constructor(private keyFn: (input: unknown) => string = defaultCacheKey) {}

  get(input: unknown): CacheLookup<T> {
    this.totalLookups++;
    const key = this.keyFn(input);
    const entry = this.store.get(key);
    if (!entry) return { hit: false };
    if (entry.expiresAt !== undefined && entry.expiresAt < Date.now()) {
      this.store.delete(key);
      return { hit: false };
    }
    entry.hitCount++;
    this.totalHits++;
    return { hit: true, entry };
  }

  set(input: unknown, value: T, opts: { provenance?: CacheEntry<T>["provenance"]; ttlMs?: number } = {}): CacheEntry<T> {
    const key = this.keyFn(input);
    const entry: CacheEntry<T> = {
      key,
      value,
      provenance: opts.provenance ?? "model",
      createdAt: Date.now(),
      expiresAt: opts.ttlMs !== undefined ? Date.now() + opts.ttlMs : undefined,
      hitCount: 0,
    };
    this.store.set(key, entry);
    return entry;
  }

  /** Invalidates a single entry (e.g. a category got renamed, a human corrected a mapping). */
  invalidate(input: unknown): boolean {
    return this.store.delete(this.keyFn(input));
  }

  /** Invalidates every entry — use when the underlying rule set changes (e.g. chart of accounts revised). */
  clear(): void {
    this.store.clear();
  }

  stats(): CacheStats {
    return {
      size: this.store.size,
      totalHits: this.totalHits,
      totalLookups: this.totalLookups,
      hitRate: this.totalLookups > 0 ? this.totalHits / this.totalLookups : 0,
    };
  }
}

/** Phase 3.4 — cache-hit accounting: dollars avoided by serving `stats.totalHits` calls from cache instead of paying `avoidedCostPerCallUsd` each. */
export function cacheSavingsUsd(stats: CacheStats, avoidedCostPerCallUsd: number): number {
  return stats.totalHits * avoidedCostPerCallUsd;
}
