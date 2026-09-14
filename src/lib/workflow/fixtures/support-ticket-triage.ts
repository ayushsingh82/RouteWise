import type { WorkflowTrace } from "../types";

/**
 * Second target workflow (PLAN.md "Next up" #2): support-ticket triage, the
 * other worked example from the source article ("imagine an agent gets an
 * email"). Deliberately shaped differently from the AP invoice trace —
 * free-text input throughout, sentiment/urgency judgment calls, a
 * refund/escalation path — to check the classifier's heuristics generalize
 * rather than being tuned to invoice processing.
 *
 * Like the AP fixture, several steps that are actually deterministic or
 * cacheable are still implemented as frontier model calls, on purpose.
 */
export const supportTicketTriageTrace: WorkflowTrace = {
  id: "support-ticket-triage",
  name: "Support Ticket Triage",
  description:
    "Receive an inbound support ticket, classify its topic and urgency, check known-issue/refund policy, and either auto-resolve, route to a cheap-tier reply, or escalate to a human agent.",
  steps: [
    {
      id: "receive_ticket",
      name: "receive_ticket",
      description: "Ingest the inbound email/chat message and normalize it into a ticket record.",
      implementation: { kind: "code", description: "Parse inbound channel payload, store as a ticket record with a stable id." },
      inputs: [{ name: "message.raw", value: "<inbound email>" }],
      outputs: [{ name: "ticket.id", value: "tkt_5512" }],
      dependsOn: [],
    },
    {
      id: "classify_topic",
      name: "classify_topic",
      description: "Assign the ticket to a topic category from the fixed support taxonomy, e.g. 'billing', 'bug_report', 'how_to'.",
      implementation: { kind: "model", model: "frontier", promptSummary: "Given this ticket body, classify it into one of our fixed support categories." },
      inputs: [{ name: "message.raw", value: "<inbound email>" }],
      outputs: [{ name: "ticket.category", value: "billing" }],
      dependsOn: ["receive_ticket"],
      observedCost: { model: "frontier", inputTokens: 2100, outputTokens: 60 },
    },
    {
      id: "check_known_issue",
      name: "check_known_issue",
      description: "Look up whether this ticket's category + keywords map to a known, already-documented issue with a canned resolution.",
      implementation: { kind: "model", model: "frontier", promptSummary: "Does this ticket match a known issue in our knowledge base? If so, which one?" },
      inputs: [
        { name: "ticket.category", value: "billing" },
        { name: "message.raw", value: "<inbound email>" },
      ],
      outputs: [{ name: "known_issue.match", value: "duplicate_charge" }],
      dependsOn: ["classify_topic"],
      observedCost: { model: "frontier", inputTokens: 3400, outputTokens: 90 },
    },
    {
      id: "assess_sentiment_urgency",
      name: "assess_sentiment_urgency",
      description: "Read the ticket's tone and content to gauge how upset/urgent the customer is, to decide routing priority.",
      implementation: { kind: "model", model: "frontier", promptSummary: "Assess the sentiment and urgency of this support message." },
      inputs: [{ name: "message.raw", value: "<inbound email>" }],
      outputs: [{ name: "ticket.priority", value: "normal" }],
      dependsOn: ["receive_ticket"],
      observedCost: { model: "frontier", inputTokens: 1800, outputTokens: 40 },
    },
    {
      id: "check_refund_eligibility",
      name: "check_refund_eligibility",
      description: "Determine whether this account is eligible for a refund based on a fixed policy table (plan tier, days since charge, prior refund count).",
      implementation: { kind: "model", model: "frontier", promptSummary: "Given this account's plan, charge date, and refund history, is a refund allowed under policy?" },
      inputs: [
        { name: "account.plan_tier", value: "pro" },
        { name: "charge.days_since", value: 4 },
        { name: "account.prior_refund_count", value: 0 },
      ],
      outputs: [{ name: "refund.eligible", value: true }],
      dependsOn: ["check_known_issue"],
      observedCost: { model: "frontier", inputTokens: 300, outputTokens: 30 },
    },
    {
      id: "assess_account_risk",
      name: "assess_account_risk",
      description: "Assess whether this ticket is part of a suspicious/abusive pattern (e.g. serial refund fraud, account takeover) given the account's full history.",
      implementation: {
        kind: "model",
        model: "frontier",
        promptSummary: "Given this account's full support and billing history, flag anything unusual or potentially fraudulent and explain why.",
      },
      inputs: [
        { name: "account.history", value: "<full account history>" },
        { name: "ticket.category", value: "billing" },
      ],
      outputs: [{ name: "risk.flagged", value: false }],
      dependsOn: ["assess_sentiment_urgency", "check_refund_eligibility"],
      observedCost: { model: "frontier", inputTokens: 6200, outputTokens: 280 },
    },
    {
      id: "draft_reply",
      name: "draft_reply",
      description: "Draft a reply to the customer given the known-issue match, refund decision, and ticket context.",
      implementation: { kind: "model", model: "frontier", promptSummary: "Draft a helpful, on-brand reply given this ticket's resolution details." },
      inputs: [
        { name: "known_issue.match", value: "duplicate_charge" },
        { name: "refund.eligible", value: true },
      ],
      outputs: [{ name: "reply.draft", value: "<drafted reply text>" }],
      dependsOn: ["assess_account_risk"],
      observedCost: { model: "frontier", inputTokens: 900, outputTokens: 260 },
    },
    {
      id: "route_for_human_review",
      name: "route_for_human_review",
      description: "If account risk is flagged or the customer is high-priority/upset, route the drafted reply to a human agent before sending.",
      implementation: { kind: "human", role: "support_agent" },
      inputs: [
        { name: "risk.flagged", value: false },
        { name: "ticket.priority", value: "normal" },
      ],
      outputs: [{ name: "review.decision", value: "approved" }],
      dependsOn: ["draft_reply"],
    },
    {
      id: "send_reply",
      name: "send_reply",
      description: "Send the approved reply back to the customer and close or update the ticket status.",
      implementation: { kind: "code", description: "Send the approved reply via the original channel; update ticket status in the support system." },
      inputs: [{ name: "review.decision", value: "approved" }],
      outputs: [{ name: "ticket.status", value: "resolved" }],
      dependsOn: ["route_for_human_review"],
    },
  ],
};
