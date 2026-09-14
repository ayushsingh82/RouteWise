import type { TaskClassification, WorkflowStep, WorkflowTrace } from "./types";

export interface StepClassification {
  stepId: string;
  classification: TaskClassification;
  /** 0-1. Steps already implemented as code/human are certain (1); heuristic guesses on model-call steps are lower. */
  confidence: number;
  rationale: string;
  signals: string[];
}

export interface ClassificationRule {
  name: string;
  /** Return a classification if this rule applies, or null to fall through to the next rule. */
  test: (step: WorkflowStep) => Omit<StepClassification, "stepId"> | null;
}

const BOOLEAN_LIKE = /^(true|false|matched|not_matched|not_duplicate|duplicate|approved|rejected|pending)$/i;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * True for a boolean, a BOOLEAN_LIKE string, or a small object whose own
 * fields are all short strings/booleans (e.g. `{action: "allow", reason:
 * "below_threshold"}`) — a fixed policy-table lookup's output shape. Content
 * moderation's `decide_action` step surfaced the object case: without it, a
 * pure lookup-table result fell through to a weaker, coincidentally-matched
 * classification instead of the higher-confidence deterministic one below.
 * Deliberately does NOT treat a bare number as small-enum — a numeric score
 * (e.g. a 0-100 toxicity rating) is a judgment call about *what* the number
 * should be, not a rule lookup; see the "bounded-scoring-rubric" rule below.
 */
function outputLooksLikeSmallEnum(step: WorkflowStep): boolean {
  return step.outputs.some((o) => {
    if (typeof o.value === "boolean") return true;
    if (typeof o.value === "string") return BOOLEAN_LIKE.test(o.value);
    if (isPlainObject(o.value)) {
      const values = Object.values(o.value);
      return values.length > 0 && values.length <= 4 && values.every((v) => typeof v === "boolean" || (typeof v === "string" && v.length <= 40));
    }
    return false;
  });
}

/**
 * Minimal rules-based classifier for Phase 1 ("Task classification").
 * Signals used follow PLAN.md Phase 1.4: input/output cardinality, presence
 * of free-text/ambiguous input, and cost-of-error keywords, applied against
 * a step's declared implementation, description, and outputs.
 *
 * Rules are ordered most-specific-and-highest-stakes first, so a step that
 * matches both a "high stakes" and a "looks like a rule" signal is treated
 * as high stakes. Falls through to `complex-judgment` (the safe default —
 * escalate rather than silently under-classify a risky step) if nothing
 * else matches.
 */
export const DEFAULT_RULES: ClassificationRule[] = [
  {
    name: "already-code",
    test: (step) =>
      step.implementation.kind === "code"
        ? {
            classification: "deterministic",
            confidence: 1,
            rationale: "Already implemented as plain code; no model call to remove.",
            signals: ["implementation.kind=code"],
          }
        : null,
  },
  {
    name: "already-human",
    test: (step) =>
      step.implementation.kind === "human"
        ? {
            classification: "complex-judgment",
            confidence: 1,
            rationale: "Already a human-in-the-loop step; this is the correct top-tier escalation, not a routing target.",
            signals: ["implementation.kind=human"],
          }
        : null,
  },
  {
    name: "high-stakes-keywords",
    test: (step) => {
      const hay = `${step.name} ${step.description}`.toLowerCase();
      if (/anomal|fraud|unusual|explain why|assess whether|risk/i.test(hay)) {
        return {
          classification: "complex-judgment",
          confidence: 0.75,
          rationale: "Description implies open-ended risk assessment with high cost of a wrong answer — keep on a frontier model or a human, don't downgrade.",
          signals: ["keyword:high-stakes"],
        };
      }
      return null;
    },
  },
  {
    // Guards against a real false-negative the content-moderation-queue fixture surfaced:
    // a step whose description happens to mention a policy/threshold — but only to say a
    // fixed rule *can't* fully decide the case ("...that a fixed score can't capture",
    // "weighs context", "case-by-case") — was matching fixed-rule-or-threshold below and
    // getting classified deterministic at 0.8 confidence purely because its output also
    // happened to be boolean. That's the dangerous direction: under-classifying a judgment
    // call as pure code. Runs before fixed-rule-or-threshold so it takes priority whenever
    // both would otherwise match.
    name: "context-sensitivity-override",
    test: (step) => {
      const hay = `${step.name} ${step.description}`.toLowerCase();
      if (/can'?t capture|weigh(s|ing)? context|\bnuance\b|case-by-case|\bsubjective\b|cultural context|judgment call/i.test(hay)) {
        return {
          classification: "complex-judgment",
          confidence: 0.7,
          rationale:
            "Description explicitly frames this as weighing context a fixed rule/threshold can't fully capture — don't let an incidental 'policy'/'threshold' mention or a boolean output misclassify this as deterministic.",
          signals: ["keyword:context-override"],
        };
      }
      return null;
    },
  },
  {
    // Documented gap the content-moderation-queue fixture found: a step that assigns a
    // numeric score against a bounded rubric (e.g. a 0-100 toxicity rating) mentions
    // "threshold"/"policy" in its description too — but the score itself is a judgment
    // call (how toxic *is* this?), not a rule lookup, so it must not match
    // fixed-rule-or-threshold below. Left unmatched, it previously fell all the way to
    // the conservative complex-judgment default — safe, but real missed savings for a
    // task a small model handles fine. Runs before fixed-rule-or-threshold.
    name: "bounded-scoring-rubric",
    test: (step) => {
      const hay = `${step.name} ${step.description}`.toLowerCase();
      const scoringLanguage = /\bscore\b|\brating\b|\brubric\b/i.test(hay);
      const boundedScale = /\b\d+\s*-\s*\d+\b|\bscale of\b|\b0\s*to\s*100\b/i.test(hay);
      const numericOutput = step.outputs.some((o) => typeof o.value === "number");
      if (scoringLanguage && boundedScale && numericOutput) {
        return {
          classification: "simple-judgment",
          confidence: 0.65,
          rationale:
            "Assigns a numeric score against a bounded, well-defined rubric/scale — the score itself requires interpretation (so it's not a rule lookup), but the decision space is narrow enough for a small model, not a frontier one.",
          signals: ["keyword:bounded-scoring-rubric"],
        };
      }
      return null;
    },
  },
  {
    name: "fixed-rule-or-threshold",
    test: (step) => {
      const hay = `${step.name} ${step.description}`.toLowerCase();
      const keywordMatch = /polic(y|ies)|threshold|fixed rule|exact match|lookup table/i.test(hay);
      if (keywordMatch && outputLooksLikeSmallEnum(step)) {
        return {
          classification: "deterministic",
          confidence: 0.8,
          rationale: "Description references a fixed policy/threshold and the output is a small enum/boolean — this is a rule lookup wearing a model-call costume; replace with code.",
          signals: ["keyword:policy-or-threshold", "output:small-enum"],
        };
      }
      return null;
    },
  },
  {
    name: "categorization-or-mapping",
    test: (step) => {
      const hay = `${step.name} ${step.description}`.toLowerCase();
      if (/categor|classif|gl code|assign.*code|map(ping)?/i.test(hay)) {
        return {
          classification: "cacheable",
          confidence: 0.75,
          rationale: "Maps a recurring input to one of a bounded set of category labels — cache (input -> label) so repeats skip the model entirely; only novel inputs need a cheap model.",
          signals: ["keyword:categorization"],
        };
      }
      return null;
    },
  },
  {
    name: "unstructured-extraction",
    test: (step) => {
      const hay = `${step.name} ${step.description}`.toLowerCase();
      if (/extract|read the (invoice|document|email)|parse/i.test(hay)) {
        return {
          classification: "simple-judgment",
          confidence: 0.7,
          rationale: "Structured extraction from a varying source document — bounded output schema, but layout/content varies enough to need a small model rather than fixed code.",
          signals: ["keyword:extraction"],
        };
      }
      return null;
    },
  },
];

/** Classifies a single step, falling back to complex-judgment (escalate, don't guess) if no rule matches. */
export function classifyStep(step: WorkflowStep, rules: ClassificationRule[] = DEFAULT_RULES): StepClassification {
  for (const rule of rules) {
    const result = rule.test(step);
    if (result) return { stepId: step.id, ...result };
  }
  return {
    stepId: step.id,
    classification: "complex-judgment",
    confidence: 0.3,
    rationale: "No classification rule matched; defaulting to the safe/expensive tier rather than guessing a downgrade.",
    signals: ["fallback:no-rule-matched"],
  };
}

export function classifyTrace(trace: WorkflowTrace, rules: ClassificationRule[] = DEFAULT_RULES): StepClassification[] {
  return trace.steps.map((step) => classifyStep(step, rules));
}

export interface ClassificationSummary {
  totalSteps: number;
  counts: Record<TaskClassification, number>;
  /** % of steps NOT already deterministic code — i.e. still spending some form of model/human judgment today. */
  modelOrHumanSteps: number;
  /** Steps currently implemented as a model call whose classification says they don't need to be. */
  downgradeCandidates: { stepId: string; classification: TaskClassification }[];
}

export function summarizeClassification(trace: WorkflowTrace, classifications: StepClassification[]): ClassificationSummary {
  const byId = new Map(trace.steps.map((s) => [s.id, s]));
  const counts: Record<TaskClassification, number> = {
    deterministic: 0,
    cacheable: 0,
    "simple-judgment": 0,
    "complex-judgment": 0,
  };
  const downgradeCandidates: ClassificationSummary["downgradeCandidates"] = [];

  for (const c of classifications) {
    counts[c.classification]++;
    const step = byId.get(c.stepId);
    if (step?.implementation.kind === "model" && (c.classification === "deterministic" || c.classification === "cacheable")) {
      downgradeCandidates.push({ stepId: c.stepId, classification: c.classification });
    }
  }

  return {
    totalSteps: classifications.length,
    counts,
    modelOrHumanSteps: trace.steps.filter((s) => s.implementation.kind !== "code").length,
    downgradeCandidates,
  };
}
