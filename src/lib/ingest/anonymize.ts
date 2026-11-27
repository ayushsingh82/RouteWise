import type { CallRecord } from "./types";
import { hashString } from "./util";

/**
 * Trace anonymization. Replaces sensitive substrings with stable, typed
 * placeholders (`<EMAIL_1>`): the same raw value always maps to the same
 * placeholder within one dataset, so structure that matters for routing —
 * repeated inputs, which caller is which — survives while the identifying
 * content does not.
 *
 * What this reliably removes: emails, phone numbers, card numbers (Luhn
 * checked), SSNs, IBANs, IPv4/IPv6 addresses, API keys / tokens / JWTs /
 * private keys, URLs (host and query, which often carry tokens), and
 * user names embedded in home-directory paths.
 *
 * What it can only do best-effort: personal *names* and organizations in free
 * text. It catches "Hi <Name>", "my name is <Name>", signature lines, and
 * anything you list in `knownTerms`. Free text can always contain something no
 * pattern anticipates, so treat the output as "safe to share with reasonable
 * review", not a legal guarantee — the report's counts tell you what was found.
 */

export type RedactionCategory =
  | "EMAIL"
  | "PHONE"
  | "CARD"
  | "SSN"
  | "IBAN"
  | "IP"
  | "SECRET"
  | "URL"
  | "PATH_USER"
  | "NAME"
  | "TERM";

export interface AnonymizeOptions {
  /** Literal strings (names, company names, project codenames) to always replace, case-insensitively. */
  knownTerms?: string[];
  /** Salt mixed into id hashing so anonymized ids can't be reversed by hashing guesses. */
  salt?: string;
  /** Keep model names, timestamps and token counts (default). Prompts/outputs/ids are always processed. */
  redactTimestamps?: boolean;
}

export interface AnonymizationReport {
  total: number;
  byCategory: Partial<Record<RedactionCategory, number>>;
  /** Distinct raw values replaced (not occurrences). */
  distinctValues: number;
}

function luhn(digits: string): boolean {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = Number(digits[i]);
    if (alt) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    alt = !alt;
  }
  return sum % 10 === 0;
}

function validIPv4(s: string): boolean {
  return s.split(".").every((o) => Number(o) <= 255);
}

export class Anonymizer {
  private maps = new Map<RedactionCategory, Map<string, number>>();
  private counts: Partial<Record<RedactionCategory, number>> = {};
  private termRegex: RegExp | null;
  private salt: string;

  constructor(private opts: AnonymizeOptions = {}) {
    this.salt = opts.salt ?? "routewise";
    const terms = (opts.knownTerms ?? []).map((t) => t.trim()).filter((t) => t.length >= 2);
    this.termRegex = terms.length > 0 ? new RegExp(`\\b(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`, "gi") : null;
  }

  private placeholder(category: RedactionCategory, raw: string): string {
    const key = category === "EMAIL" || category === "TERM" || category === "NAME" ? raw.toLowerCase() : raw;
    let map = this.maps.get(category);
    if (!map) this.maps.set(category, (map = new Map()));
    let idx = map.get(key);
    if (idx === undefined) map.set(key, (idx = map.size + 1));
    this.counts[category] = (this.counts[category] ?? 0) + 1;
    return `<${category}_${idx}>`;
  }

  text(input: string): string {
    if (!input) return input;
    let s = input;
    const sub = (re: RegExp, category: RedactionCategory, guard?: (m: string) => boolean) => {
      s = s.replace(re, (m) => (guard && !guard(m) ? m : this.placeholder(category, m)));
    };

    // Secrets first: they often contain characters other patterns would partially match.
    sub(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "SECRET");
    sub(/\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}\b/g, "SECRET");
    sub(/\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}\b/g, "SECRET");
    sub(/\bgh[pousr]_[A-Za-z0-9]{30,}\b/g, "SECRET");
    sub(/\bAKIA[0-9A-Z]{16}\b/g, "SECRET");
    sub(/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, "SECRET");
    sub(/\bAIza[0-9A-Za-z_-]{35}\b/g, "SECRET");
    sub(/\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/g, "SECRET");
    s = s.replace(/\b(api[_-]?key|secret|token|passw(?:or)?d|pwd)(\s*[:=]\s*)(["']?)([^\s"',;]{6,})\3/gi, (_m, label, sep, q, val) => `${label}${sep}${q}${this.placeholder("SECRET", val)}${q}`);

    sub(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "EMAIL");
    sub(/\bhttps?:\/\/[^\s)>\]"'<]+/g, "URL");
    // Home-directory paths: keep the structure, drop the account name.
    s = s.replace(/(\/Users\/|\/home\/|[A-Za-z]:\\Users\\)([^/\\\s"']+)/g, (_m, pre, name) => `${pre}${name === "user" ? name : this.placeholder("PATH_USER", name)}`);

    sub(/\b(?:\d[ -]?){12,18}\d\b/g, "CARD", (m) => {
      const d = m.replace(/[ -]/g, "");
      return d.length >= 13 && d.length <= 19 && luhn(d);
    });
    sub(/\b\d{3}-\d{2}-\d{4}\b/g, "SSN");
    sub(/\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){2,7}(?:[ ]?[A-Z0-9]{1,4})?\b/g, "IBAN", (m) => m.replace(/ /g, "").length >= 15 && /\d/.test(m.slice(2, 4)));
    sub(/\b(?:\+?\d{1,3}[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]\d{3}[\s.-]\d{4}\b/g, "PHONE");
    sub(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "IP", validIPv4);
    sub(/\b(?:[0-9a-f]{1,4}:){7}[0-9a-f]{1,4}\b/gi, "IP");

    // Best-effort names: greetings, self-introductions, sign-offs.
    s = s.replace(/\b(my name is|Hi|Hello|Dear)(\s+)([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/g, (_m, lead, ws, name) => `${lead}${ws}${this.placeholder("NAME", name)}`);
    s = s.replace(/\b(Regards|Thanks|Best|Sincerely|Cheers),(\s*\n\s*)([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/g, (_m, lead, ws, name) => `${lead},${ws}${this.placeholder("NAME", name)}`);

    if (this.termRegex) s = s.replace(this.termRegex, (m) => this.placeholder("TERM", m));
    return s;
  }

  id(raw: string): string {
    return `id_${hashString(`${this.salt}:${raw}`)}`;
  }

  call(c: CallRecord): CallRecord {
    return {
      ...c,
      id: this.id(c.id),
      sessionId: this.id(c.sessionId),
      system: c.system !== undefined ? this.text(c.system) : undefined,
      input: this.text(c.input),
      output: this.text(c.output),
      task: c.task !== undefined ? this.text(c.task) : undefined,
      timestamp: this.opts.redactTimestamps ? null : c.timestamp,
    };
  }

  report(): AnonymizationReport {
    const total = Object.values(this.counts).reduce((a, b) => a + (b ?? 0), 0);
    let distinct = 0;
    for (const m of this.maps.values()) distinct += m.size;
    return { total, byCategory: { ...this.counts }, distinctValues: distinct };
  }
}

export function anonymizeCalls(calls: CallRecord[], opts: AnonymizeOptions = {}): { calls: CallRecord[]; report: AnonymizationReport } {
  const a = new Anonymizer(opts);
  const out = calls.map((c) => a.call(c));
  return { calls: out, report: a.report() };
}
