// Client-safe constants: no replay engine, no Node APIs.
/**
 * Evidence-tiered savings: every dollar of claimed savings is tagged with how
 * it is known, from weakest to strongest. This is the answer to "show me the
 * 90%": the report says which part is arithmetic, which part was replayed on
 * your real traffic, and which part actually happened and matches your invoice.
 */
export type EvidenceTier = "modeled" | "benchmarked" | "replayed" | "measured" | "verified";

export const TIER_ORDER: EvidenceTier[] = ["modeled", "benchmarked", "replayed", "measured", "verified"];

export const TIER_INFO: Record<EvidenceTier, { label: string; short: string; description: string }> = {
  modeled: {
    label: "Modeled",
    short: "estimate",
    description: "Classifier + price table arithmetic. Assumes the cheaper route gives an acceptable answer. No quality evidence yet.",
  },
  benchmarked: {
    label: "Benchmarked",
    short: "quality tested",
    description: "The savings number is still modeled, but a labeled benchmark shows the cheaper tier reproduces the reference answers (95% lower bound above threshold).",
  },
  replayed: {
    label: "Replayed",
    short: "shadow-tested",
    description: "The routing policy was replayed over your recorded traffic with real token counts; cached/downgraded answers were checked against what the model actually said.",
  },
  measured: {
    label: "Measured",
    short: "live",
    description: "Savings recorded by the live proxy on real requests, using provider-reported token usage.",
  },
  verified: {
    label: "Invoice-verified",
    short: "invoice-matched",
    description: "Measured savings whose actual spend reconciles with the provider invoice within tolerance. (The counterfactual baseline remains an estimate.)",
  },
};


/** Tier colors shared by the HTML report, PDF, badge and dashboard. */
export const TIER_COLOR: Record<EvidenceTier, string> = {
  modeled: "#b68a1a",
  benchmarked: "#2f7f8f",
  replayed: "#2d7ff9",
  measured: "#2e9e5b",
  verified: "#1b8a3e",
};
