import { NextResponse } from "next/server";
import { classifyTrace, summarizeClassification } from "@/lib/workflow/classify";
import { classifyTraceWithFallback } from "@/lib/workflow/classify-model";
import { createAnthropicClassifier } from "@/lib/workflow/providers/anthropic-classifier";
import { routeTrace, summarizeRouting } from "@/lib/workflow/router";
import { assessWorkflowHealth } from "@/lib/workflow/health";
import { computeTraceSavings } from "@/lib/workflow/savings";
import { ingestWorkflowTrace, WorkflowIngestError } from "@/lib/workflow/ingest";
import { apInvoiceProcessingTrace } from "@/lib/workflow/fixtures/ap-invoice-processing";
import { supportTicketTriageTrace } from "@/lib/workflow/fixtures/support-ticket-triage";
import { contentModerationQueueTrace } from "@/lib/workflow/fixtures/content-moderation-queue";
import type { WorkflowTrace } from "@/lib/workflow/types";

/**
 * Server-side counterpart to `src/cli/analyze.ts` (Product Wedge A) — same
 * ingest -> classify -> route -> savings -> health pipeline, exposed over
 * HTTP so the dashboard in `src/app/page.tsx` can render it. GET serves a
 * built-in fixture; POST runs the same pipeline against an uploaded trace.
 */

const BUILTIN_FIXTURES: Record<string, WorkflowTrace> = {
  "ap-invoice": apInvoiceProcessingTrace,
  "support-ticket-triage": supportTicketTriageTrace,
  "content-moderation-queue": contentModerationQueueTrace,
};

async function runPipeline(trace: WorkflowTrace, modelFallbackRequested: boolean) {
  const hasApiKey = Boolean(process.env.ANTHROPIC_API_KEY);
  const usedModelFallback = modelFallbackRequested && hasApiKey;

  const classifications = usedModelFallback
    ? await classifyTraceWithFallback(trace, createAnthropicClassifier())
    : classifyTrace(trace);

  const classificationSummary = summarizeClassification(trace, classifications);
  const decisions = routeTrace(trace, classifications);
  const routingSummary = summarizeRouting(decisions);
  const health = assessWorkflowHealth(trace, classifications);
  const savings = computeTraceSavings(trace, classifications);

  return {
    traceId: trace.id,
    traceName: trace.name,
    traceDescription: trace.description,
    fixtures: Object.keys(BUILTIN_FIXTURES),
    modelFallback: { requested: modelFallbackRequested, used: usedModelFallback, apiKeyConfigured: hasApiKey },
    classifications,
    classificationSummary,
    routing: decisions,
    routingSummary,
    health,
    savings,
  };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const fixtureName = searchParams.get("fixture") ?? "ap-invoice";
  const modelFallbackRequested = searchParams.get("modelFallback") === "true";

  const trace = BUILTIN_FIXTURES[fixtureName];
  if (!trace) {
    return NextResponse.json(
      { error: `Unknown fixture "${fixtureName}". Available: ${Object.keys(BUILTIN_FIXTURES).join(", ")}` },
      { status: 400 },
    );
  }

  return NextResponse.json(await runPipeline(trace, modelFallbackRequested));
}

/** Runs the pipeline against an uploaded trace: `{ trace: <raw JSON>, modelFallback?: boolean }`. */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  if (typeof body !== "object" || body === null || !("trace" in body)) {
    return NextResponse.json({ error: 'Request body must be an object with a "trace" field.' }, { status: 400 });
  }

  const { trace: rawTrace, modelFallback } = body as { trace: unknown; modelFallback?: boolean };

  let trace: WorkflowTrace;
  try {
    trace = ingestWorkflowTrace(rawTrace);
  } catch (err) {
    if (err instanceof WorkflowIngestError) {
      return NextResponse.json({ error: `Invalid workflow trace: ${err.message}` }, { status: 400 });
    }
    throw err;
  }

  return NextResponse.json(await runPipeline(trace, modelFallback === true));
}
