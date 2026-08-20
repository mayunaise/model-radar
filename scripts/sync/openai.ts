import OpenAI from "openai";
import { z } from "zod";
import { summarySchema } from "../../src/lib/domain/schemas";
import type { Summary } from "../../src/lib/domain/types";
import { estimateTokens } from "./budget";
import { candidateInput, SUMMARY_PROMPT_VERSION, summaryInstructions } from "./prompts";
import type { NormalizedCandidate } from "./types";

type RequestConfig = {
  model: "gpt-5.6-luna";
  reasoningEffort: "none";
  itemMaxInputTokens: number;
  itemMaxOutputTokens: number;
  maxRetries: number;
};

type ResponseResult = {
  output_text: string;
  usage?: { input_tokens: number; output_tokens: number } | null;
};

export interface ResponsesClient {
  create(input: Record<string, unknown>): Promise<ResponseResult>;
}

const modelOutputSchema = z.object({
  headline_zh: z.string().min(1).max(80),
  summary_zh: z.string().min(1).max(2000),
  models: z.array(z.string()),
  hardware: z.array(z.enum(["GPU", "NPU", "CPU", "UNKNOWN"])),
  scenarios: z.array(z.enum(["TRAINING", "INFERENCE", "RL", "EVALUATION", "OTHER"])),
  category: z.enum(["NEW_SUPPORT", "BUG", "FIX", "PERFORMANCE", "DOCS", "COMPATIBILITY", "OTHER"]),
  severity: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"]),
  impact_scope_zh: z.string().max(500),
  attention: z.enum(["IMMEDIATE", "WATCH", "ROUTINE"]),
  capability_candidate: z.boolean(),
  evidence: z.array(z.string().max(300)),
});

const jsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["headline_zh", "summary_zh", "models", "hardware", "scenarios", "category", "severity", "impact_scope_zh", "attention", "capability_candidate", "evidence"],
  properties: {
    headline_zh: { type: "string", maxLength: 80 },
    summary_zh: { type: "string", maxLength: 2000 },
    models: { type: "array", items: { type: "string" } },
    hardware: { type: "array", items: { type: "string", enum: ["GPU", "NPU", "CPU", "UNKNOWN"] } },
    scenarios: { type: "array", items: { type: "string", enum: ["TRAINING", "INFERENCE", "RL", "EVALUATION", "OTHER"] } },
    category: { type: "string", enum: ["NEW_SUPPORT", "BUG", "FIX", "PERFORMANCE", "DOCS", "COMPATIBILITY", "OTHER"] },
    severity: { type: "string", enum: ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"] },
    impact_scope_zh: { type: "string", maxLength: 500 },
    attention: { type: "string", enum: ["IMMEDIATE", "WATCH", "ROUTINE"] },
    capability_candidate: { type: "boolean" },
    evidence: { type: "array", items: { type: "string", maxLength: 300 } },
  },
};

function truncateCandidate(candidate: NormalizedCandidate, maxTokens: number) {
  let truncated = false;
  let bodyExcerpt = candidate.bodyExcerpt;
  let input = candidateInput({ ...candidate, bodyExcerpt });
  if (estimateTokens(input) > maxTokens) {
    const fixed = candidateInput({ ...candidate, bodyExcerpt: "" });
    const bodyBudgetBytes = Math.max(0, Math.floor((maxTokens - estimateTokens(fixed)) * 2.5));
    bodyExcerpt = Buffer.from(bodyExcerpt, "utf8").subarray(0, bodyBudgetBytes).toString("utf8");
    input = candidateInput({ ...candidate, bodyExcerpt });
    truncated = true;
  }
  return { input, truncated };
}

function toSummary(output: z.infer<typeof modelOutputSchema>, now: string, truncated: boolean): Summary {
  return summarySchema.parse({
    headlineZh: output.headline_zh,
    summaryZh: output.summary_zh,
    models: output.models,
    hardware: output.hardware,
    scenarios: output.scenarios,
    category: output.category,
    severity: output.severity,
    impactScopeZh: output.impact_scope_zh,
    attention: output.attention,
    capabilityCandidate: output.capability_candidate,
    evidence: output.evidence,
    truncated,
    model: "gpt-5.6-luna",
    promptVersion: SUMMARY_PROMPT_VERSION,
    generatedAt: now,
  });
}

function isRetryable(error: unknown): boolean {
  if (error instanceof SyntaxError || error instanceof z.ZodError) return true;
  if (typeof error === "object" && error && "status" in error) {
    const status = Number((error as { status: unknown }).status);
    return status === 429 || status >= 500;
  }
  return false;
}

export async function summarizeCandidate(
  client: ResponsesClient,
  candidate: NormalizedCandidate,
  config: RequestConfig,
  now: string,
) {
  const { input, truncated } = truncateCandidate(candidate, config.itemMaxInputTokens);
  let inputTokens = 0;
  let outputTokens = 0;
  let lastError: unknown;

  for (let attempt = 0; attempt <= config.maxRetries; attempt += 1) {
    try {
      const response = await client.create({
        model: config.model,
        reasoning: { effort: config.reasoningEffort },
        instructions: summaryInstructions,
        input,
        tools: [],
        store: false,
        max_output_tokens: config.itemMaxOutputTokens,
        text: { format: { type: "json_schema", name: "glm_activity_summary", strict: true, schema: jsonSchema } },
      });
      inputTokens += response.usage?.input_tokens ?? 0;
      outputTokens += response.usage?.output_tokens ?? 0;
      const parsed = modelOutputSchema.parse(JSON.parse(response.output_text));
      return {
        summary: toSummary(parsed, now, truncated),
        usage: { inputTokens, outputTokens },
      };
    } catch (error) {
      lastError = error;
      if (attempt >= config.maxRetries || !isRetryable(error)) throw error;
    }
  }
  throw lastError;
}

export function createResponsesClient(apiKey: string): ResponsesClient {
  const client = new OpenAI({ apiKey });
  return {
    async create(input) {
      const response = await client.responses.create(input as never);
      return {
        output_text: response.output_text,
        usage: response.usage
          ? { input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens }
          : null,
      };
    },
  };
}
