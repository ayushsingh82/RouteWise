// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";
import Dashboard from "./dashboard";
import { GET, POST } from "./api/analyze/route";
import { FIXTURE_LABELS, SAMPLE_LABELS } from "./_components/catalog";
import { FIXTURES, SAMPLES } from "@/lib/analysis/sources";
import { renderCodex, generateCodingCalls } from "@/lib/ingest/sample-data";

/** Routes fetch() to the real API handlers, so the dashboard is tested against real response shapes. */
function wireFetchToRoutes() {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const res = init?.method === "POST" ? await POST(new Request(`http://localhost${url}`, init)) : await GET(new Request(`http://localhost${url}`));
    return res as unknown as Response;
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("catalog", () => {
  it("matches the server's fixtures and samples exactly", () => {
    expect(Object.keys(FIXTURE_LABELS).sort()).toEqual(Object.keys(FIXTURES).sort());
    expect(Object.keys(SAMPLE_LABELS).sort()).toEqual(SAMPLES.map((s) => s.id).sort());
  });
});

describe("Dashboard evidence view", () => {
  it("shows an empty history state before anything has been analyzed", async () => {
    wireFetchToRoutes();
    render(<Dashboard />);
    expect(screen.getByText("No analyses yet")).toBeInTheDocument();
    await screen.findByText(/Savings by evidence tier/);
  });

  it("renders evidence tiers, the before/after chart and a report download for a fixture", async () => {
    wireFetchToRoutes();
    render(<Dashboard />);
    await screen.findByText(/Savings by evidence tier/);
    expect(screen.getByRole("img", { name: /Spend before and after routing/ })).toBeInTheDocument();
    // a hand-authored fixture has no recorded traffic: the panel must say it's modeled
    expect(screen.getAllByText("Modeled").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "Download PDF" })).toHaveAttribute("href", "/api/report?fixture=ap-invoice&format=pdf&download=1");
  });

  it("loads a recorded-traffic sample, shows replay evidence and anonymization, and records it in history", async () => {
    const fetchMock = wireFetchToRoutes();
    render(<Dashboard />);
    await screen.findByText(/Savings by evidence tier/);

    fireEvent.change(screen.getByLabelText("Recorded-traffic sample"), { target: { value: "langsmith-support-ops" } });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/analyze?sample=langsmith-support-ops&modelFallback=false"));

    expect(await screen.findByText(/Anonymized before analysis/)).toBeInTheDocument();
    expect(screen.getAllByText("Replayed").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Copy README badge" })).toBeInTheDocument();

    const history = screen.getByRole("heading", { name: "Trace history" }).closest("section")!;
    await waitFor(() => expect(within(history).getByText("Sample · LangSmith — support ops")).toBeInTheDocument());
    expect(within(history).getByText("Workflow · AP Invoice Processing")).toBeInTheDocument();
  });

  it("reopens an entry from history, and can remove and clear entries", async () => {
    const fetchMock = wireFetchToRoutes();
    render(<Dashboard />);
    await screen.findByText(/Savings by evidence tier/);
    fireEvent.change(screen.getByLabelText("Recorded-traffic sample"), { target: { value: "otel-support-ops" } });
    await screen.findByText(/Anonymized before analysis/);

    fireEvent.click(screen.getAllByRole("button", { name: "Open" }).at(-1)!); // oldest entry = the AP fixture
    await waitFor(() => expect(fetchMock).toHaveBeenLastCalledWith("/api/analyze?fixture=ap-invoice&modelFallback=false"));

    fireEvent.click(screen.getAllByRole("button", { name: /Remove .* from history/ })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    await waitFor(() => expect(screen.getByText("No analyses yet")).toBeInTheDocument());
  });

  it("survives unavailable localStorage", async () => {
    wireFetchToRoutes();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    render(<Dashboard />);
    expect(await screen.findByText(/Savings by evidence tier/)).toBeInTheDocument();
    vi.restoreAllMocks();
  });

  it("uploads a raw JSONL tool export (Codex) as {raw}, not as a workflow trace", async () => {
    const fetchMock = wireFetchToRoutes();
    render(<Dashboard />);
    await screen.findByText(/Savings by evidence tier/);

    const text = renderCodex(generateCodingCalls({ provider: "openai" }));
    fireEvent.change(screen.getByLabelText(/Upload trace/i), { target: { files: [new File([text], "rollout.jsonl")] } });

    await waitFor(() => expect(screen.getByText("📄 rollout.jsonl")).toBeInTheDocument());
    await waitFor(() => {
      const last = fetchMock.mock.calls.at(-1)!;
      expect(last[0]).toBe("/api/analyze");
      expect(JSON.parse(String(last[1]!.body))).toMatchObject({ raw: text, fileName: "rollout" });
    });
    await screen.findByText(/Built from \d+ recorded calls \(codex/);
    // uploads are not reopenable from history
    expect(screen.getByText("Upload · rollout.jsonl")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download PDF" })).toBeInTheDocument();
  });

  it("rejects oversized uploads without calling the server", async () => {
    const fetchMock = wireFetchToRoutes();
    render(<Dashboard />);
    await screen.findByText(/Savings by evidence tier/);
    const before = fetchMock.mock.calls.length;
    const big = new File(["x".repeat(4 * 1024 * 1024 + 10)], "huge.jsonl");
    fireEvent.change(screen.getByLabelText(/Upload trace/i), { target: { files: [big] } });
    expect(await screen.findByText(/over 4 MB/)).toBeInTheDocument();
    expect(fetchMock.mock.calls.length).toBe(before);
  });

  it("surfaces a server-side parse failure for an unrecognized export", async () => {
    wireFetchToRoutes();
    render(<Dashboard />);
    await screen.findByText(/Savings by evidence tier/);
    fireEvent.change(screen.getByLabelText(/Upload trace/i), { target: { files: [new File(['{"hello":"world"}'], "mystery.json")] } });
    expect(await screen.findByText(/Could not detect the trace format/)).toBeInTheDocument();
  });
});

describe("error boundary and empty states", () => {
  const goodBase = async () => (await GET(new Request("http://localhost/api/analyze?fixture=ap-invoice"))).json();

  it("contains a render crash from malformed evidence instead of blanking the page", async () => {
    const body = await goodBase();
    body.evidence = { totals: null, tasks: [], caveats: [], assumptions: [] }; // passes shape checks, crashes on render
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body }));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<Dashboard />);
    expect(await screen.findByText("The analysis couldn't be displayed.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Savings dashboard" })).toBeInTheDocument(); // rest of the page still there
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    spy.mockRestore();
  });

  it("shows a 'no savings found' empty state rather than an empty chart", async () => {
    const body = await goodBase();
    body.evidence.totals.savedUsd = 0;
    body.evidence.totals.savedPct = 0;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body }));
    render(<Dashboard />);
    expect(await screen.findByText("No savings found")).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /Spend before and after/ })).not.toBeInTheDocument();
  });

  it("shows an empty state for a trace with no steps", async () => {
    const body = await goodBase();
    body.savings.steps = [];
    body.evidence = undefined;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body }));
    render(<Dashboard />);
    expect(await screen.findByText("No steps to show")).toBeInTheDocument();
  });
});
