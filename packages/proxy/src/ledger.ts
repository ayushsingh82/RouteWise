import { appendFileSync } from "node:fs";
import type { DecisionRecord } from "../../../src/lib/gateway/types";

/**
 * Append-only decision ledger. Holds only routing metadata — task id, action,
 * models, token counts, dollars — never prompts, completions or credentials, so
 * it is safe to keep, ship to a dashboard, or hand to an auditor.
 */
export class Ledger {
  private records: DecisionRecord[] = [];
  constructor(private file?: string, private maxInMemory = 50_000) {}

  add(r: DecisionRecord): void {
    this.records.push(r);
    if (this.records.length > this.maxInMemory) this.records.shift();
    if (this.file) {
      try {
        appendFileSync(this.file, `${JSON.stringify(r)}\n`);
      } catch {
        /* a full disk must never take down the request path */
      }
    }
  }

  all(): DecisionRecord[] {
    return this.records;
  }
}
