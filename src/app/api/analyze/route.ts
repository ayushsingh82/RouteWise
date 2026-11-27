import { NextResponse } from "next/server";
import { classifyTrace, summarizeClassification } from "@/lib/workflow/classify";
import { classifyTraceWithFallback } from "@/lib/workflow/classify-model";
import { createAnthropicClassifier } from "@/lib/workflow/providers/anthropic-classifier";
import { routeTrace, summarizeRouting } from "@/lib/workflow/router";
import { assessWorkflowHealth } from "@/lib/workflow/health";
import { computeTraceSavings } from "@/lib/workflow/savings";
import { AnalysisInputError, FIXTURES, SAMPLES, resolveSource, sourceFromBody, sourceFromParams, type ResolvedSource } from "@/lib/analysis/sources";
import { evidenceFor } from "@/lib/analysis/evidence";

/**
 * Server-side counterpart to `src/cli/analyze.ts` (Product Wedge A) — same
 * ingest -> classify -> route -> savings -> health pipeline, exposed over
 * HTTP so the dashboard can render it, plus an evidence-tiered report
 * (modeled / benchmarked / replayed / measured / verified). GET serves a
 * built-in fixture or bundled sample dataset; POST runs the pipeline against
 * an uploaded workflow trace (`{trace}`) or a raw tool export (`{raw}`).
 */

async function runPipeline(resolved: ResolvedSource, modelFallbackRequested: boolean) {
  const { trace } = resolved;
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
  const evidence = await evidenceFor(resolved, { classifications, savings });

  return {
    traceId: trace.id,
    traceName: trace.name,
    traceDescription: trace.description,
    fixtures: Object.keys(FIXTURES),
    samples: SAMPLES,
    modelFallback: { requested: modelFallbackRequested, used: usedModelFallback, apiKeyConfigured: hasApiKey },
    classifications,
    classificationSummary,
    routing: decisions,
    routingSummary,
    health,
    savings,
    evidence,
    ingest: resolved.calls
      ? { format: resolved.sourceFormat, calls: resolved.calls.length, models: [...new Set(resolved.calls.map((c) => c.model))], anonymization: resolved.anonymization ?? null }
      : null,
  };
}

function badRequest(err: unknown) {
  if (err instanceof AnalysisInputError) return NextResponse.json({ error: err.message }, { status: 400 });
  throw err;
}

// Replaying a recorded trace and rendering a PDF are CPU work; give them headroom on serverless.
export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const modelFallbackRequested = searchParams.get("modelFallback") === "true";
  try {
    return NextResponse.json(await runPipeline(resolveSource(sourceFromParams(searchParams)), modelFallbackRequested));
  } catch (err) {
    return badRequest(err);
  }
}

/** Runs the pipeline against an upload: `{ trace }` or `{ raw, format?, anonymize?, terms? }`, plus `modelFallback?`. */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  try {
    const modelFallback = typeof body === "object" && body !== null && (body as { modelFallback?: unknown }).modelFallback === true;
    return NextResponse.json(await runPipeline(resolveSource(sourceFromBody(body)), modelFallback));
  } catch (err) {
    return badRequest(err);
  }
}
