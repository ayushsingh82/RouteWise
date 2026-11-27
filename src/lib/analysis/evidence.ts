import type { StepClassification } from "@/lib/workflow/classify";
import type { TraceSavingsReport } from "@/lib/workflow/savings";
import { buildEvidenceReport, buildEvidenceReportFromCalls, type EvidenceReport } from "@/lib/report/evidence";
import type { ResolvedSource } from "./sources";

/**
 * Evidence report for a resolved source. Recorded traffic gets the full
 * replay + benchmark treatment; a hand-authored workflow has nothing to
 * replay, so it is (honestly) modeled-only.
 */
export async function evidenceFor(
  resolved: ResolvedSource,
  pre: { classifications: StepClassification[]; savings: TraceSavingsReport },
): Promise<EvidenceReport> {
  if (resolved.calls) {
    return buildEvidenceReportFromCalls(resolved.calls, { title: resolved.label, anonymization: resolved.anonymization });
  }
  return buildEvidenceReport({ trace: resolved.trace, classifications: pre.classifications, savings: pre.savings, title: resolved.label });
}
