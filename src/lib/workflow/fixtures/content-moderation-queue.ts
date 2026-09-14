import type { WorkflowTrace } from "../types";

/**
 * Third target workflow (PLAN.md "Next up" #3): content moderation queue.
 * Deliberately adversarial to `classify.ts`'s `fixed-rule-or-threshold` rule,
 * which only recognizes a threshold lookup as deterministic when its output
 * "looks like a small enum" (boolean or a BOOLEAN_LIKE string). This fixture
 * has two threshold-driven steps whose real-world outputs are a raw numeric
 * score and a nested multi-field object, respectively — neither of which
 * `outputLooksLikeSmallEnum` recognizes, even though both are exactly the
 * "fixed threshold, should be code" shape the rule was written to catch.
 */
export const contentModerationQueueTrace: WorkflowTrace = {
  id: "content-moderation-queue",
  name: "Content Moderation Queue",
  description:
    "Receive a user-generated post, score it against policy thresholds, categorize its type, assess borderline/ambiguous cases, decide an action, and route appeals to a human reviewer.",
  steps: [
    {
      id: "receive_post",
      name: "receive_post",
      description: "Ingest the submitted post/comment and normalize it into a moderation queue record.",
      implementation: { kind: "code", description: "Store the raw content + author/context metadata as a queue record." },
      inputs: [{ name: "content.raw", value: "<submitted text>" }],
      outputs: [{ name: "post.id", value: "post_77213" }],
      dependsOn: [],
    },
    {
      id: "score_toxicity",
      name: "score_toxicity",
      description: "Score the post against a fixed policy threshold table (0-100 toxicity scale) to decide if it crosses the auto-remove line.",
      implementation: {
        kind: "model",
        model: "frontier",
        promptSummary: "Given this post, output a toxicity score from 0-100 per our policy rubric.",
      },
      inputs: [{ name: "content.raw", value: "<submitted text>" }],
      // Adversarial: a raw numeric score, not a boolean/small-enum -- the
      // fixed-rule-or-threshold rule's outputLooksLikeSmallEnum check misses this.
      outputs: [{ name: "toxicity.score", value: 42 }],
      dependsOn: ["receive_post"],
      observedCost: { model: "frontier", inputTokens: 800, outputTokens: 20 },
    },
    {
      id: "classify_content_type",
      name: "classify_content_type",
      description: "Assign the post to a content type category from the fixed taxonomy, e.g. 'spam', 'harassment', 'misinformation', 'benign'.",
      implementation: { kind: "model", model: "frontier", promptSummary: "Categorize this post into one of our fixed content-type categories." },
      inputs: [{ name: "content.raw", value: "<submitted text>" }],
      outputs: [{ name: "content.category", value: "benign" }],
      dependsOn: ["receive_post"],
      observedCost: { model: "frontier", inputTokens: 750, outputTokens: 30 },
    },
    {
      id: "decide_action",
      name: "decide_action",
      description: "Apply the fixed policy decision table (toxicity score x content category) to decide the moderation action and record the reason.",
      implementation: {
        kind: "model",
        model: "frontier",
        promptSummary: "Given this toxicity score and content category, apply our policy table to decide the action and reason.",
      },
      inputs: [
        { name: "toxicity.score", value: 42 },
        { name: "content.category", value: "benign" },
      ],
      // Adversarial: a nested multi-field object, not a boolean/small-enum --
      // also misses outputLooksLikeSmallEnum despite being a pure lookup-table result.
      outputs: [{ name: "moderation.decision", value: { action: "allow", reason: "below_threshold" } }],
      dependsOn: ["score_toxicity", "classify_content_type"],
      observedCost: { model: "frontier", inputTokens: 300, outputTokens: 60 },
    },
    {
      id: "assess_borderline_context",
      name: "assess_borderline_context",
      description: "For posts near the policy threshold, weigh context (satire, quotation, reclaimed language, cultural context) that a fixed score can't capture.",
      implementation: {
        kind: "model",
        model: "frontier",
        promptSummary: "Given this borderline post and its surrounding context, assess whether it should be treated as a policy violation.",
      },
      inputs: [
        { name: "content.raw", value: "<submitted text>" },
        { name: "moderation.decision", value: "<see decide_action output>" },
      ],
      outputs: [{ name: "context_assessment.override", value: false }],
      dependsOn: ["decide_action"],
      observedCost: { model: "frontier", inputTokens: 2600, outputTokens: 180 },
    },
    {
      id: "route_appeal_to_human",
      name: "route_appeal_to_human",
      description: "If the author appeals a removal, route the post and moderation history to a human reviewer for final judgment.",
      implementation: { kind: "human", role: "trust_and_safety_reviewer" },
      inputs: [{ name: "moderation.decision", value: "<see decide_action output>" }],
      outputs: [{ name: "appeal.decision", value: "upheld" }],
      dependsOn: ["assess_borderline_context"],
    },
    {
      id: "apply_action",
      name: "apply_action",
      description: "Apply the final moderation action (allow/remove/warn) to the post and log the outcome.",
      implementation: { kind: "code", description: "Write the final action to the content store and moderation log." },
      inputs: [{ name: "moderation.decision", value: "<see decide_action output>" }],
      outputs: [{ name: "post.status", value: "resolved" }],
      dependsOn: ["route_appeal_to_human"],
    },
  ],
};
