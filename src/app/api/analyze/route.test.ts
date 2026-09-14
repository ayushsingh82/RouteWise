import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { GET, POST } from "./route";
import { apInvoiceProcessingTrace } from "@/lib/workflow/fixtures/ap-invoice-processing";

function req(query: string): Request {
  return new Request(`http://localhost/api/analyze${query}`);
}

function postReq(body: unknown): Request {
  return new Request("http://localhost/api/analyze", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
}

describe("GET /api/analyze", () => {
  const originalKey = process.env.ANTHROPIC_API_KEY;

  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });

  afterEach(() => {
    if (originalKey !== undefined) process.env.ANTHROPIC_API_KEY = originalKey;
    vi.restoreAllMocks();
  });

  it("defaults to the ap-invoice fixture when no fixture param is given", async () => {
    const res = await GET(req(""));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.traceId).toBe("ap-invoice-processing");
  });

  it("serves each built-in fixture and returns a full pipeline result", async () => {
    for (const fixture of ["ap-invoice", "support-ticket-triage", "content-moderation-queue"]) {
      const res = await GET(req(`?fixture=${fixture}`));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.classifications).toHaveLength(body.savings.steps.length);
      expect(body.routingSummary.totalSteps).toBe(body.classifications.length);
      expect(typeof body.savings.totals.savingsVsNaiveFrontierPct).toBe("number");
    }
  });

  it("returns 400 for an unknown fixture", async () => {
    const res = await GET(req("?fixture=bogus"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Unknown fixture/);
  });

  it("reports modelFallback.used=false when requested but no API key is configured", async () => {
    const res = await GET(req("?fixture=ap-invoice&modelFallback=true"));
    const body = await res.json();
    expect(body.modelFallback).toEqual({ requested: true, used: false, apiKeyConfigured: false });
    // Falls back to the rules-only classifier -- no network call should have been attempted.
    expect(body.classifications.every((c: { signals: string[] }) => !c.signals.includes("fallback:model-classified"))).toBe(true);
  });

  it("does not request the model fallback when the flag is absent", async () => {
    const res = await GET(req("?fixture=ap-invoice"));
    const body = await res.json();
    expect(body.modelFallback).toEqual({ requested: false, used: false, apiKeyConfigured: false });
  });
});

describe("POST /api/analyze", () => {
  it("runs the pipeline against an uploaded trace", async () => {
    const res = await POST(postReq({ trace: apInvoiceProcessingTrace }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.traceId).toBe("ap-invoice-processing");
    expect(body.classifications).toHaveLength(apInvoiceProcessingTrace.steps.length);
  });

  it("returns 400 with a validation message for a malformed trace", async () => {
    const res = await POST(postReq({ trace: { id: "t" } })); // missing name/steps
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Invalid workflow trace/);
  });

  it("returns 400 when the body has no trace field", async () => {
    const res = await POST(postReq({ notATrace: true }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/"trace" field/);
  });

  it("returns 400 for a non-JSON body", async () => {
    const res = await POST(new Request("http://localhost/api/analyze", { method: "POST", body: "not json" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/valid JSON/);
  });

  it("defaults modelFallback to false when omitted", async () => {
    const res = await POST(postReq({ trace: apInvoiceProcessingTrace }));
    const body = await res.json();
    expect(body.modelFallback.requested).toBe(false);
  });
});
