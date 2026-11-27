import { NextResponse } from "next/server";
import { classifyTrace } from "@/lib/workflow/classify";
import { computeTraceSavings } from "@/lib/workflow/savings";
import { AnalysisInputError, resolveSource, sourceFromBody, sourceFromParams, type AnalysisSource } from "@/lib/analysis/sources";
import { evidenceFor } from "@/lib/analysis/evidence";
import { renderHtml } from "@/lib/report/html";
import { renderPdf } from "@/lib/report/pdf";
import { badgeForReport } from "@/lib/report/badge";

/**
 * Shareable artifacts for an analysis:
 *   GET  /api/report?fixture=ap-invoice|sample=<id>&format=html|pdf|json|badge
 *   POST /api/report  { as: "html"|"pdf"|"json"|"badge", ...same body as /api/analyze }   (uploads; `format` there is the TRACE format)
 * `format=badge` returns the README savings badge SVG (the tier is part of the text).
 */

type Format = "html" | "pdf" | "json" | "badge";
const FORMATS: Format[] = ["html", "pdf", "json", "badge"];

async function respond(source: AnalysisSource, format: Format, download: boolean) {
  const resolved = resolveSource(source);
  const classifications = classifyTrace(resolved.trace);
  const savings = computeTraceSavings(resolved.trace, classifications);
  const report = await evidenceFor(resolved, { classifications, savings });
  const base = report.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "report";

  switch (format) {
    case "html":
      return new Response(renderHtml(report), { headers: { "content-type": "text/html; charset=utf-8", ...(download ? { "content-disposition": `attachment; filename="${base}-savings.html"` } : {}) } });
    case "pdf":
      return new Response(Buffer.from(await renderPdf(report)), { headers: { "content-type": "application/pdf", "content-disposition": `${download ? "attachment" : "inline"}; filename="${base}-savings.pdf"` } });
    case "badge":
      return new Response(badgeForReport(report), { headers: { "content-type": "image/svg+xml; charset=utf-8", "cache-control": "public, max-age=300, s-maxage=3600" } });
    case "json":
      return NextResponse.json(report);
  }
}

function parseFormat(v: unknown): Format {
  if (typeof v === "string" && (FORMATS as string[]).includes(v)) return v as Format;
  throw new AnalysisInputError(`format must be one of: ${FORMATS.join(", ")}`);
}

function fail(err: unknown) {
  if (err instanceof AnalysisInputError) return NextResponse.json({ error: err.message }, { status: 400 });
  throw err;
}

// Replaying a recorded trace and rendering a PDF are CPU work; give them headroom on serverless.
export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  try {
    return await respond(sourceFromParams(searchParams), parseFormat(searchParams.get("format") ?? "html"), searchParams.get("download") === "1");
  } catch (err) {
    return fail(err);
  }
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  try {
    const format = parseFormat((body as { as?: unknown } | null)?.as ?? "html");
    return await respond(sourceFromBody(body), format, true);
  } catch (err) {
    return fail(err);
  }
}
