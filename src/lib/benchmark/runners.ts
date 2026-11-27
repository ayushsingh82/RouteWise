import type { Candidate, BenchmarkCase } from "./benchmark";
import type { ResourceTier } from "../workflow/pricing";

/**
 * Live candidates that call a provider's HTTP API directly (no SDK needed, so
 * they work anywhere `fetch` does). Keys are passed in, never read implicitly
 * from disk. Temperature 0 so a benchmark run is as repeatable as the API allows.
 */

async function postJson(url: string, headers: Record<string, string>, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as Record<string, unknown>;
}

export function anthropicCandidate(opts: { apiKey: string; model: string; tier: ResourceTier; baseUrl?: string; maxTokens?: number }): Candidate {
  return {
    id: `anthropic:${opts.model}`,
    tier: opts.tier,
    model: opts.model,
    run: async (c: BenchmarkCase) => {
      const json = (await postJson(`${opts.baseUrl ?? "https://api.anthropic.com"}/v1/messages`, { "x-api-key": opts.apiKey, "anthropic-version": "2023-06-01" }, {
        model: opts.model,
        max_tokens: opts.maxTokens ?? 1024,
        temperature: 0,
        ...(c.system ? { system: c.system } : {}),
        messages: [{ role: "user", content: c.input }],
      })) as { content?: { type: string; text?: string }[]; usage?: { input_tokens?: number; output_tokens?: number } };
      return { output: (json.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join(""), inputTokens: json.usage?.input_tokens, outputTokens: json.usage?.output_tokens };
    },
  };
}

export function openaiCandidate(opts: { apiKey: string; model: string; tier: ResourceTier; baseUrl?: string }): Candidate {
  return {
    id: `openai:${opts.model}`,
    tier: opts.tier,
    model: opts.model,
    run: async (c: BenchmarkCase) => {
      const json = (await postJson(`${opts.baseUrl ?? "https://api.openai.com"}/v1/chat/completions`, { authorization: `Bearer ${opts.apiKey}` }, {
        model: opts.model,
        temperature: 0,
        messages: [...(c.system ? [{ role: "system", content: c.system }] : []), { role: "user", content: c.input }],
      })) as { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
      return { output: json.choices?.[0]?.message?.content ?? "", inputTokens: json.usage?.prompt_tokens, outputTokens: json.usage?.completion_tokens };
    },
  };
}
