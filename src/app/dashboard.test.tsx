// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import Dashboard from "./dashboard";

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 400) {
  return { ok, status, json: async () => body } as Response;
}

const AP_INVOICE_RESPONSE = {
  traceId: "ap-invoice-processing",
  traceName: "AP Invoice Processing",
  traceDescription: "Process an invoice.",
  fixtures: ["ap-invoice", "support-ticket-triage", "content-moderation-queue"],
  modelFallback: { requested: false, used: false, apiKeyConfigured: false },
  classifications: [],
  classificationSummary: { totalSteps: 0, counts: { deterministic: 0, cacheable: 0, "simple-judgment": 0, "complex-judgment": 0 }, modelOrHumanSteps: 0, downgradeCandidates: [] },
  routing: [],
  routingSummary: { totalSteps: 0, code: 1, cache: 1, human: 0, model: { "non-frontier": 1, "near-frontier": 0, frontier: 1 }, modelSharePct: { "non-frontier": 0.5, "near-frontier": 0, frontier: 0.5 }, escalatedCount: 0 },
  health: { traceId: "ap-invoice-processing", modelStepShare: 0.44, downgradeableStepIds: ["gl_code_line_item"], isDecompositionCandidate: true, reasons: ["44% of steps are currently routed through a model call."] },
  savings: {
    traceId: "ap-invoice-processing",
    traceName: "AP Invoice Processing",
    assumptions: {},
    steps: [
      { stepId: "gl_code_line_item", classification: "cacheable", tokenSource: "observed", inputTokens: 900, outputTokens: 180, naiveFrontierUsd: 0.027, currentUsd: 0.027, recommendedUsd: 0.0001, recommendedBasis: "cache it" },
    ],
    totals: { naiveFrontierUsd: 0.2194, currentUsd: 0.2177, recommendedUsd: 0.1056, savingsVsNaiveFrontierUsd: 0.1137, savingsVsNaiveFrontierPct: 0.518, savingsVsCurrentUsd: 0.112, savingsVsCurrentPct: 0.515 },
  },
};

describe("Dashboard", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(AP_INVOICE_RESPONSE)));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("fetches the default ap-invoice fixture on mount and renders the savings figures", async () => {
    render(<Dashboard />);
    expect(screen.getByText("Analyzing…")).toBeInTheDocument();

    await waitFor(() => expect(screen.getByText("$0.1056")).toBeInTheDocument());
    expect(fetch).toHaveBeenCalledWith("/api/analyze?fixture=ap-invoice&modelFallback=false");
    expect(screen.getByText("51.8%")).toBeInTheDocument();
    expect(screen.getByText("Decomposition candidate")).toBeInTheDocument();
  });

  it("re-fetches with the selected fixture when a fixture button is clicked", async () => {
    render(<Dashboard />);
    await waitFor(() => expect(screen.getByText("$0.1056")).toBeInTheDocument());

    fireEvent.click(screen.getByText("Support Ticket Triage"));

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith("/api/analyze?fixture=support-ticket-triage&modelFallback=false"),
    );
  });

  it("re-fetches with modelFallback=true when the toggle is checked", async () => {
    render(<Dashboard />);
    await waitFor(() => expect(screen.getByText("$0.1056")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("checkbox"));

    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/analyze?fixture=ap-invoice&modelFallback=true"));
  });

  it("shows the API-key warning banner when model fallback was requested but not used", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({ ...AP_INVOICE_RESPONSE, modelFallback: { requested: true, used: false, apiKeyConfigured: false } }),
      ),
    );
    render(<Dashboard />);
    await waitFor(() => expect(screen.getByText(/ANTHROPIC_API_KEY isn't configured/)).toBeInTheDocument());
  });

  it("shows an error message when the request fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ error: "boom" }, false)));
    render(<Dashboard />);
    await waitFor(() => expect(screen.getByText("boom")).toBeInTheDocument());
  });

  it("uploads a custom trace file and POSTs it to the API", async () => {
    const parsedTrace = { id: "custom-trace", name: "Custom", steps: [] };
    const file = new File([JSON.stringify(parsedTrace)], "custom.json", { type: "application/json" });

    render(<Dashboard />);
    await waitFor(() => expect(screen.getByText("$0.1056")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/Upload trace/i), { target: { files: [file] } });

    await waitFor(() => expect(screen.getByText("📄 custom.json")).toBeInTheDocument());
    await waitFor(() =>
      expect(fetch).toHaveBeenLastCalledWith(
        "/api/analyze",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ trace: parsedTrace, modelFallback: false }),
        }),
      ),
    );
  });

  it("shows an error and does not fetch when the uploaded file isn't valid JSON", async () => {
    const file = new File(["not json"], "bad.json", { type: "application/json" });

    render(<Dashboard />);
    await waitFor(() => expect(screen.getByText("$0.1056")).toBeInTheDocument());
    const callsBefore = vi.mocked(fetch).mock.calls.length;

    fireEvent.change(screen.getByLabelText(/Upload trace/i), { target: { files: [file] } });

    await waitFor(() => expect(screen.getByText(/Could not parse "bad.json" as JSON/)).toBeInTheDocument());
    expect(vi.mocked(fetch).mock.calls.length).toBe(callsBefore);
  });

  it("switching back to a fixture after an upload re-fetches via GET", async () => {
    const file = new File([JSON.stringify({ id: "custom-trace", name: "Custom", steps: [] })], "custom.json", { type: "application/json" });

    render(<Dashboard />);
    await waitFor(() => expect(screen.getByText("$0.1056")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/Upload trace/i), { target: { files: [file] } });
    await waitFor(() => expect(screen.getByText("📄 custom.json")).toBeInTheDocument());

    fireEvent.click(screen.getByText("AP Invoice Processing"));

    await waitFor(() => expect(fetch).toHaveBeenLastCalledWith("/api/analyze?fixture=ap-invoice&modelFallback=false"));
  });
});
