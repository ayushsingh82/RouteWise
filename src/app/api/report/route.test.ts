import { describe, expect, it } from "vitest";
import { GET, POST } from "./route";
import { renderLangSmith, generateSupportOpsCalls } from "@/lib/ingest/sample-data";

const get = (q: string) => GET(new Request(`http://localhost/api/report${q}`));
const post = (body: unknown) => POST(new Request("http://localhost/api/report", { method: "POST", body: JSON.stringify(body) }));

describe("GET /api/report", () => {
  it("serves an HTML report for a fixture, labeled as modeled", async () => {
    const res = await get("?fixture=ap-invoice&format=html");
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("Savings report");
    expect(html).toContain("Modeled");
  });

  it("serves a real PDF for a sample dataset", async () => {
    const res = await get("?sample=langsmith-support-ops&format=pdf");
    expect(res.headers.get("content-type")).toBe("application/pdf");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
  });

  it("serves a cacheable SVG badge that states its tier", async () => {
    const res = await get("?sample=langsmith-support-ops&format=badge");
    expect(res.headers.get("content-type")).toContain("image/svg+xml");
    expect(res.headers.get("cache-control")).toContain("max-age");
    expect(await res.text()).toMatch(/\d+% · (replayed|modeled|benchmarked)/);
  });

  it("returns the evidence report as JSON", async () => {
    const body = await (await get("?sample=openai-support-ops&format=json")).json();
    expect(Object.keys(body.totals.byTier)).toEqual(["modeled", "benchmarked", "replayed", "measured", "verified"]);
  });

  it("400s on unknown format or source", async () => {
    expect((await get("?format=docx")).status).toBe(400);
    expect((await get("?sample=nope")).status).toBe(400);
  });
});

describe("POST /api/report with an uploaded raw trace", () => {
  it("anonymizes by default and says so in the report", async () => {
    const res = await post({ raw: renderLangSmith(generateSupportOpsCalls({ tickets: 30 })), as: "html" });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("anonymized");
  });

  it("400s on an unparseable trace instead of crashing", async () => {
    expect((await post({ raw: '{"nope":1}', as: "html" })).status).toBe(400);
  });
});
