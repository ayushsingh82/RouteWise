import type { WorkflowTrace } from "../types";

/**
 * Synthetic trace for the AP invoice processing workflow — the first target
 * workflow chosen in PLAN.md ("Immediate next steps"), matching the source
 * tweet's own worked example (stapler -> "office supplies" GL code).
 *
 * Deliberately modeled the way a real "agentic" implementation looks before
 * decomposition: several steps that are actually deterministic or cacheable
 * are still routed through a frontier model call, which is exactly the
 * waste Phase 1's classifier should catch.
 */
export const apInvoiceProcessingTrace: WorkflowTrace = {
  id: "ap-invoice-processing",
  name: "AP Invoice Processing",
  description:
    "Receive an incoming vendor invoice, extract line items, GL-code them, match to a PO, check approval thresholds, screen for duplicates/anomalies, and route for payment or human approval.",
  steps: [
    {
      id: "receive_invoice",
      name: "receive_invoice",
      description: "Download the invoice email/attachment and normalize it into a stored document.",
      implementation: { kind: "code", description: "Fetch attachment, store to document storage, record metadata." },
      inputs: [{ name: "email.raw", value: "<mime message>" }],
      outputs: [{ name: "invoice.document_id", value: "doc_8841" }],
      dependsOn: [],
    },
    {
      id: "extract_line_items",
      name: "extract_line_items",
      description: "Read the invoice document and extract structured line items (description, qty, unit price, vendor, invoice #).",
      implementation: { kind: "model", model: "frontier", promptSummary: "Extract line items from this invoice document as structured JSON." },
      inputs: [{ name: "invoice.document_id", value: "doc_8841" }],
      outputs: [
        {
          name: "invoice.line_items",
          value: [
            { description: "Stapler, heavy duty", qty: 2, unit_price: 14.99 },
            { description: "AWS EC2 usage - Aug", qty: 1, unit_price: 4302.11 },
          ],
        },
      ],
      dependsOn: ["receive_invoice"],
      observedCost: { model: "frontier", inputTokens: 3200, outputTokens: 420 },
    },
    {
      id: "gl_code_line_item",
      name: "gl_code_line_item",
      description: "Assign a GL (general ledger) category code to each line item, e.g. 'Stapler' -> 'Office Supplies'.",
      implementation: { kind: "model", model: "frontier", promptSummary: "Given this line item description, assign the correct GL code from the chart of accounts." },
      inputs: [{ name: "invoice.line_items", value: "<see extract_line_items output>" }],
      outputs: [
        {
          name: "invoice.line_items_coded",
          value: [
            { description: "Stapler, heavy duty", gl_code: "6410 - Office Supplies" },
            { description: "AWS EC2 usage - Aug", gl_code: "6820 - Cloud Infrastructure" },
          ],
        },
      ],
      dependsOn: ["extract_line_items"],
      observedCost: { model: "frontier", inputTokens: 900, outputTokens: 180 },
    },
    {
      id: "match_purchase_order",
      name: "match_purchase_order",
      description: "Look up the PO number referenced on the invoice and confirm vendor/amount match the PO record.",
      implementation: { kind: "code", description: "Exact-match PO number and vendor id against the ERP's PO table; compare totals within tolerance." },
      inputs: [{ name: "invoice.po_number", value: "PO-55231" }],
      outputs: [{ name: "po_match.status", value: "matched" }],
      dependsOn: ["receive_invoice"],
    },
    {
      id: "check_duplicate",
      name: "check_duplicate",
      description: "Check whether this vendor + invoice number has already been processed.",
      implementation: { kind: "code", description: "Hash (vendor_id, invoice_number) and look up in the processed-invoices index." },
      inputs: [
        { name: "invoice.vendor_id", value: "vendor_204" },
        { name: "invoice.invoice_number", value: "INV-99213" },
      ],
      outputs: [{ name: "duplicate_check.status", value: "not_duplicate" }],
      dependsOn: ["receive_invoice"],
    },
    {
      id: "check_approval_threshold",
      name: "check_approval_threshold",
      description: "Determine whether the invoice total requires manager/finance approval based on a fixed dollar-threshold table.",
      implementation: { kind: "model", model: "frontier", promptSummary: "Given this invoice total and department, does it require approval per company policy?" },
      inputs: [
        { name: "invoice.total", value: 4332.09 },
        { name: "invoice.department", value: "Engineering" },
      ],
      outputs: [{ name: "approval.required", value: true }],
      dependsOn: ["gl_code_line_item", "match_purchase_order"],
      observedCost: { model: "frontier", inputTokens: 260, outputTokens: 40 },
    },
    {
      id: "flag_anomaly",
      name: "flag_anomaly",
      description: "Assess whether this invoice looks anomalous or potentially fraudulent given vendor history, amount, and timing.",
      implementation: { kind: "model", model: "frontier", promptSummary: "Given this invoice and the vendor's last 12 months of invoices, flag anything unusual and explain why." },
      inputs: [
        { name: "invoice.line_items_coded", value: "<see gl_code_line_item output>" },
        { name: "vendor.invoice_history", value: "<last 12 months>" },
      ],
      outputs: [{ name: "anomaly.flagged", value: false }],
      dependsOn: ["check_duplicate", "check_approval_threshold"],
      observedCost: { model: "frontier", inputTokens: 5400, outputTokens: 310 },
    },
    {
      id: "route_for_human_approval",
      name: "route_for_human_approval",
      description: "If approval is required and no anomaly is flagged, route to the department manager's approval queue.",
      implementation: { kind: "human", role: "department_manager" },
      inputs: [
        { name: "approval.required", value: true },
        { name: "anomaly.flagged", value: false },
      ],
      outputs: [{ name: "approval.decision", value: "pending" }],
      dependsOn: ["flag_anomaly"],
    },
    {
      id: "record_payment",
      name: "record_payment",
      description: "Once approved, write the invoice to the ERP as approved-for-payment and schedule the payment run.",
      implementation: { kind: "code", description: "Write invoice status + coded line items to ERP; enqueue in the next payment batch." },
      inputs: [{ name: "approval.decision", value: "approved" }],
      outputs: [{ name: "invoice.status", value: "scheduled_for_payment" }],
      dependsOn: ["route_for_human_approval"],
    },
  ],
};
