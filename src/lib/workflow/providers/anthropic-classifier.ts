import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { ModelClassifier, ModelClassifierInput, ModelClassifierOutput } from "../classify-model";

/**
 * "Next up" #1 — the real provider wired behind `ModelClassifier`
 * (`classify-model.ts`). This is one concrete implementation, not the only
 * one possible — the interface stays provider-agnostic on purpose so a
 * caller can swap this out.
 *
 * Deliberately a small, cheap, bounded classification call (one of the
 * "simple, well-bounded decision space" tasks this project's own thesis says
 * shouldn't need a frontier model) — kept at the default model here per this
 * repo's model-selection guidance, but the model is a constructor param so a
 * caller can point it at a cheaper tier for production use.
 */

const OutputSchema = z.object({
  classification: z.enum(["deterministic", "cacheable", "simple-judgment", "complex-judgment"]),
  confidence: z.number().min(0).max(1),
  rationale: z.string(),
});

export interface AnthropicClassifierOptions {
  apiKey?: string;
  model?: string;
  client?: Anthropic;
}

const DEFAULT_MODEL = "claude-opus-5";

function buildPrompt({ step, ruleResult }: ModelClassifierInput): string {
  return [
    "Classify one step of a business workflow into exactly one of these categories:",
    "- deterministic: the output is a pure function of the input (a fixed rule, threshold, or lookup) — should be plain code.",
    "- cacheable: the same input recurs and maps to a stable, bounded output (a category/label assignment) — should be served from a cache, falling back to a model on a miss.",
    "- simple-judgment: requires interpretation, but within a narrow, well-bounded decision space — a small/cheap model can handle it reliably.",
    "- complex-judgment: ambiguous, high-context, or high-stakes (cost of a wrong answer is high) — needs a frontier model or a human.",
    "",
    `Step name: ${step.name}`,
    `Step description: ${step.description}`,
    `Declared inputs: ${step.inputs.map((i) => i.name).join(", ") || "(none)"}`,
    `Declared outputs: ${step.outputs.map((o) => o.name).join(", ") || "(none)"}`,
    "",
    `A rules-based classifier already looked at this step and could not confidently place it (rationale: "${ruleResult.rationale}").`,
    "Use your judgment on the step's actual content to classify it. When genuinely unsure, prefer the more conservative (higher) category — a wrong downgrade is worse than an unnecessary escalation.",
  ].join("\n");
}

/**
 * Builds a `ModelClassifier` backed by the Claude API. Reads `ANTHROPIC_API_KEY`
 * from the environment by default (via a bare `new Anthropic()`); pass
 * `apiKey` or an existing `client` to override. Throws only on a genuine API
 * failure — `classifyStepWithFallback` in `classify-model.ts` already catches
 * and degrades to the rules-based result, so this function doesn't need its
 * own fallback logic.
 */
export function createAnthropicClassifier(options: AnthropicClassifierOptions = {}): ModelClassifier {
  const client = options.client ?? new Anthropic(options.apiKey ? { apiKey: options.apiKey } : undefined);
  const model = options.model ?? DEFAULT_MODEL;

  return async function anthropicClassifier(input: ModelClassifierInput): Promise<ModelClassifierOutput> {
    const response = await client.messages.parse({
      model,
      max_tokens: 1024,
      messages: [{ role: "user", content: buildPrompt(input) }],
      output_config: { format: zodOutputFormat(OutputSchema) },
    });

    if (!response.parsed_output) {
      throw new Error(`Anthropic classifier returned unparseable output for step "${input.step.id}"`);
    }

    return response.parsed_output;
  };
}
