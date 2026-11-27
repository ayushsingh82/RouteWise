/**
 * Output scoring for per-task benchmarking. Each mode returns a 0-1 score and
 * a pass flag; `auto` picks the strictest mode that suits the reference.
 *  - json:       reference parses as JSON -> every reference field must match (order-insensitive); score = fraction matched
 *  - exact:      short free text (<= 6 words) -> normalized string equality
 *  - token-f1:   longer free text -> token-overlap F1, pass at >= 0.8. A rough proxy; for open-ended prose pass a `judge`.
 */

export type ScoreMode = "auto" | "json" | "exact" | "token-f1";

export interface Score {
  score: number;
  pass: boolean;
  mode: Exclude<ScoreMode, "auto">;
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

function tryJson(s: string): unknown | undefined {
  const t = s.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  if (!/^[{[]/.test(t)) return undefined;
  try {
    return JSON.parse(t);
  } catch {
    return undefined;
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (typeof a === "string" && typeof b === "string") return norm(a) === norm(b);
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  return ka.length === kb.length && ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

function scoreJson(reference: unknown, output: unknown): number {
  if (typeof reference === "object" && reference !== null && !Array.isArray(reference) && typeof output === "object" && output !== null && !Array.isArray(output)) {
    const keys = Object.keys(reference);
    if (keys.length === 0) return 1;
    const o = output as Record<string, unknown>;
    return keys.filter((k) => deepEqual((reference as Record<string, unknown>)[k], o[k])).length / keys.length;
  }
  return deepEqual(reference, output) ? 1 : 0;
}

function tokenF1(a: string, b: string): number {
  const ta = norm(a).split(/\W+/).filter(Boolean);
  const tb = norm(b).split(/\W+/).filter(Boolean);
  if (ta.length === 0 && tb.length === 0) return 1;
  if (ta.length === 0 || tb.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const t of ta) counts.set(t, (counts.get(t) ?? 0) + 1);
  let overlap = 0;
  for (const t of tb) {
    const c = counts.get(t) ?? 0;
    if (c > 0) {
      overlap++;
      counts.set(t, c - 1);
    }
  }
  if (overlap === 0) return 0;
  const p = overlap / tb.length;
  const r = overlap / ta.length;
  return (2 * p * r) / (p + r);
}

export function scoreOutput(reference: string, output: string, mode: ScoreMode = "auto"): Score {
  const refJson = tryJson(reference);
  const resolved: Exclude<ScoreMode, "auto"> =
    mode !== "auto" ? mode : refJson !== undefined ? "json" : norm(reference).split(" ").length <= 6 ? "exact" : "token-f1";

  if (resolved === "json") {
    const outJson = tryJson(output);
    const score = refJson !== undefined && outJson !== undefined ? scoreJson(refJson, outJson) : 0;
    return { score, pass: score === 1, mode: resolved };
  }
  if (resolved === "exact") {
    const pass = norm(reference) === norm(output);
    return { score: pass ? 1 : 0, pass, mode: resolved };
  }
  const f1 = tokenF1(reference, output);
  return { score: f1, pass: f1 >= 0.8, mode: resolved };
}
