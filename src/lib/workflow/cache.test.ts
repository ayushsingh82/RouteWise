import { describe, expect, it, vi } from "vitest";
import { cacheSavingsUsd, defaultCacheKey, WorkflowCache } from "./cache";

describe("defaultCacheKey", () => {
  it("trims and lowercases string inputs", () => {
    expect(defaultCacheKey("  Stapler  ")).toBe("stapler");
  });

  it("JSON-stringifies non-string inputs", () => {
    expect(defaultCacheKey({ a: 1 })).toBe(JSON.stringify({ a: 1 }));
  });
});

describe("WorkflowCache", () => {
  it("misses on an empty cache and hits after set", () => {
    const cache = new WorkflowCache<string>();
    expect(cache.get("stapler").hit).toBe(false);
    cache.set("stapler", "Office Supplies");
    const lookup = cache.get("stapler");
    expect(lookup.hit).toBe(true);
    expect(lookup.entry?.value).toBe("Office Supplies");
  });

  it("normalizes keys so case/whitespace variants hit the same entry", () => {
    const cache = new WorkflowCache<string>();
    cache.set("Stapler", "Office Supplies");
    expect(cache.get("  stapler  ").hit).toBe(true);
  });

  it("increments hitCount and totalHits on repeated hits", () => {
    const cache = new WorkflowCache<string>();
    cache.set("stapler", "Office Supplies");
    cache.get("stapler");
    cache.get("stapler");
    expect(cache.get("stapler").entry?.hitCount).toBe(3);
    expect(cache.stats().totalHits).toBe(3);
  });

  it("expires entries past ttlMs", () => {
    vi.useFakeTimers();
    const cache = new WorkflowCache<string>();
    cache.set("stapler", "Office Supplies", { ttlMs: 1000 });
    vi.advanceTimersByTime(1001);
    expect(cache.get("stapler").hit).toBe(false);
    vi.useRealTimers();
  });

  it("invalidate removes a single entry", () => {
    const cache = new WorkflowCache<string>();
    cache.set("stapler", "Office Supplies");
    expect(cache.invalidate("stapler")).toBe(true);
    expect(cache.get("stapler").hit).toBe(false);
  });

  it("clear removes every entry", () => {
    const cache = new WorkflowCache<string>();
    cache.set("stapler", "Office Supplies");
    cache.set("laptop", "Equipment");
    cache.clear();
    expect(cache.stats().size).toBe(0);
  });

  it("supports a custom keyFn", () => {
    const cache = new WorkflowCache<string>((input) => String(input).toLowerCase().replace(/\s+/g, ""));
    cache.set("Heavy Duty Stapler", "Office Supplies");
    expect(cache.get("heavydutystapler").hit).toBe(true);
  });

  it("computes hitRate across lookups", () => {
    const cache = new WorkflowCache<string>();
    cache.set("stapler", "Office Supplies");
    cache.get("stapler"); // hit
    cache.get("laptop"); // miss
    expect(cache.stats().hitRate).toBe(0.5);
  });
});

describe("cacheSavingsUsd", () => {
  it("multiplies hits by the avoided cost per call", () => {
    const stats = { size: 1, totalHits: 10, totalLookups: 12, hitRate: 10 / 12 };
    expect(cacheSavingsUsd(stats, 0.02)).toBeCloseTo(0.2);
  });
});
