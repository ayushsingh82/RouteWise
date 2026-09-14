#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { ingestWorkflowTrace, WorkflowIngestError } from "../lib/workflow/ingest";
import { classifyTrace, summarizeClassification, type StepClassification } from "../lib/workflow/classify";
import { classifyTraceWithFallback } from "../lib/workflow/classify-model";
import { createAnthropicClassifier } from "../lib/workflow/providers/anthropic-classifier";
import { routeTrace, summarizeRouting } from "../lib/workflow/router";
import { assessWorkflowHealth } from "../lib/workflow/health";
import { computeTraceSavings, formatSavingsReport } from "../lib/workflow/savings";
import { apInvoiceProcessingTrace } from "../lib/workflow/fixtures/ap-invoice-processing";
import { supportTicketTriageTrace } from "../lib/workflow/fixtures/support-ticket-triage";
import { contentModerationQueueTrace } from "../lib/workflow/fixtures/content-moderation-queue";
import type { WorkflowTrace } from "../lib/workflow/types";

/**
 * Product Wedge A, wired end-to-end (PLAN.md "Next up" #5): the analyzer/audit
 * CLI. Takes a raw workflow trace (JSON file, or a built-in fixture for a
 * demo run), and runs ingest -> classify -> route -> savings -> health,
 * printing the shareable audit report this wedge sells.
 *
 * Usage:
 *   npm run analyze -- <path-to-trace.json> [--json] [--model-fallback]
 *   npm run analyze -- --fixture <ap-invoice|support-ticket-triage> [--json] [--model-fallback]
 *
 * --json           print a machine-readable report instead of the plain-text one.
 * --model-fallback use the Claude API (see providers/anthropic-classifier.ts) to
 *                   classify steps the rules left unconfident, instead of taking
 *                   the rules' conservative default. Requires ANTHROPIC_API_KEY
 *                   (or another credential source the SDK picks up) — falls back
 *                   to rules-only with a warning if none is configured.
 */

const BUILTIN_FIXTURES: Record<string, WorkflowTrace> = {
  "ap-invoice": apInvoiceProcessingTrace,
  "support-ticket-triage": supportTicketTriageTrace,
  "content-moderation-queue": contentModerationQueueTrace,
};

interface ParsedArgs {
  fixture?: string;
  path?: string;
  json: boolean;
  modelFallback: boolean;
}

function usage(): never {
  console.error(
    [
      "Usage:",
      "  npm run analyze -- <path-to-trace.json> [--json] [--model-fallback]",
      `  npm run analyze -- --fixture <${Object.keys(BUILTIN_FIXTURES).join("|")}> [--json] [--model-fallback]`,
    ].join("\n"),
  );
  process.exit(1);
}

function parseArgs(argv: string[]): ParsedArgs {
  const result: ParsedArgs = { json: false, modelFallback: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") result.json = true;
    else if (arg === "--model-fallback") result.modelFallback = true;
    else if (arg === "--fixture") result.fixture = argv[++i];
    else if (!arg.startsWith("--") && result.path === undefined && result.fixture === undefined) result.path = arg;
    else usage();
  }
  if (result.fixture === undefined && result.path === undefined) usage();
  return result;
}

function loadTrace(args: ParsedArgs): WorkflowTrace {
  if (args.fixture !== undefined) {
    const fixture = BUILTIN_FIXTURES[args.fixture];
    if (!fixture) {
      console.error(`Unknown fixture "${args.fixture}". Available: ${Object.keys(BUILTIN_FIXTURES).join(", ")}`);
      usage();
    }
    return fixture;
  }

  const path = args.path!;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf-8"));
  } catch (err) {
    console.error(`Could not read/parse "${path}": ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  try {
    return ingestWorkflowTrace(raw);
  } catch (err) {
    if (err instanceof WorkflowIngestError) {
      console.error(`Invalid workflow trace: ${err.message}`);
      process.exit(1);
    }
    throw err;
  }
}

async function resolveClassifications(trace: WorkflowTrace, args: ParsedArgs): Promise<StepClassification[]> {
  if (!args.modelFallback) return classifyTrace(trace);

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("--model-fallback requested but ANTHROPIC_API_KEY is not set; continuing with rules-only classification.\n");
    return classifyTrace(trace);
  }

  return classifyTraceWithFallback(trace, createAnthropicClassifier());
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const trace = loadTrace(args);

  const classifications = await resolveClassifications(trace, args);
  const classificationSummary = summarizeClassification(trace, classifications);
  const decisions = routeTrace(trace, classifications);
  const routingSummary = summarizeRouting(decisions);
  const health = assessWorkflowHealth(trace, classifications);
  const savings = computeTraceSavings(trace, classifications);

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          traceId: trace.id,
          traceName: trace.name,
          classifications,
          classificationSummary,
          routing: decisions,
          routingSummary,
          health,
          savings,
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log(formatSavingsReport(savings));
  console.log();
  console.log("Classification breakdown:");
  for (const [classification, count] of Object.entries(classificationSummary.counts)) {
    console.log(`  ${classification.padEnd(18)} ${count}`);
  }
  console.log();
  console.log("Routing (90/9/1-style split, share of calls that hit a model):");
  for (const [tier, share] of Object.entries(routingSummary.modelSharePct)) {
    console.log(`  ${tier.padEnd(14)} ${(share * 100).toFixed(1)}%`);
  }
  console.log(`  code=${routingSummary.code} cache=${routingSummary.cache} human=${routingSummary.human} escalated=${routingSummary.escalatedCount}`);
  console.log();
  console.log(`Workflow health: ${health.isDecompositionCandidate ? "DECOMPOSITION CANDIDATE" : "OK"}`);
  for (const reason of health.reasons) console.log(`  - ${reason}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
