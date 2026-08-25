import OpenAI from "openai";
import { z } from "zod";
import { summarySchema } from "../../src/lib/domain/schemas";
import { categoryDefinitionsForType, isCategoryAllowedForType } from "../../src/lib/config/categories";
import type { CategoryConfig, Summary } from "../../src/lib/domain/types";
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

export const OPENAI_REQUEST_TIMEOUT_MS = 30_000;

// The schema leaves headroom above the requested editorial limits so a model
// is not forced to cut a clause exactly at a JSON Schema boundary.
const nullableSubjectField = z.string().min(1).max(400).nullable();
const nullableCoreField = z.string().min(1).max(800).nullable();
const modelOutputSchema = z.object({
  headline_zh: z.string().min(1).max(50),
  kind: z.enum(["problem", "request", "change"]),
  subject_zh: nullableSubjectField,
  problem_zh: nullableCoreField,
  request_zh: nullableCoreField,
  change_zh: nullableCoreField,
  impact_zh: z.string().min(1).max(380).nullable(),
  models: z.array(z.string()),
  hardware: z.array(z.enum(["GPU", "NPU", "CPU", "UNKNOWN"])),
  scenarios: z.array(z.enum(["TRAINING", "INFERENCE", "RL", "EVALUATION", "OTHER"])),
  category: z.enum(["NEW_SUPPORT", "BUG", "FIX", "PERFORMANCE", "DOCS", "COMPATIBILITY", "OTHER"]),
  severity: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"]),
  impact_scope_zh: z.string().max(500),
  attention: z.enum(["IMMEDIATE", "WATCH", "ROUTINE"]),
  capability_candidate: z.boolean(),
  evidence: z.array(z.object({
    source: z.enum(["title", "body"]),
    text: z.string().min(1).max(120),
  })).min(1).max(2),
}).superRefine((output, context) => {
  const requiredField = output.kind === "problem" ? output.problem_zh
    : output.kind === "request" ? output.request_zh
      : output.change_zh;
  if (!requiredField) context.addIssue({ code: "custom", path: [output.kind], message: `Missing required field for ${output.kind}` });
});

function jsonSchemaFor(config: CategoryConfig, type: NormalizedCandidate["type"]) {
  const categoryCodes = categoryDefinitionsForType(config, type).map((category) => category.code);
  return {
  type: "object",
  additionalProperties: false,
  required: ["headline_zh", "kind", "subject_zh", "problem_zh", "request_zh", "change_zh", "impact_zh", "models", "hardware", "scenarios", "category", "severity", "impact_scope_zh", "attention", "capability_candidate", "evidence"],
  properties: {
    headline_zh: { type: "string", maxLength: 50 },
    kind: { type: "string", enum: ["problem", "request", "change"] },
    subject_zh: { type: ["string", "null"], minLength: 1, maxLength: 400 },
    problem_zh: { type: ["string", "null"], minLength: 1, maxLength: 800 },
    request_zh: { type: ["string", "null"], minLength: 1, maxLength: 800 },
    change_zh: { type: ["string", "null"], minLength: 1, maxLength: 800 },
    impact_zh: { type: ["string", "null"], minLength: 1, maxLength: 380 },
    models: { type: "array", items: { type: "string" } },
    hardware: { type: "array", items: { type: "string", enum: ["GPU", "NPU", "CPU", "UNKNOWN"] } },
    scenarios: { type: "array", items: { type: "string", enum: ["TRAINING", "INFERENCE", "RL", "EVALUATION", "OTHER"] } },
    category: { type: "string", enum: categoryCodes },
    severity: { type: "string", enum: ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"] },
    impact_scope_zh: { type: "string", maxLength: 500 },
    attention: { type: "string", enum: ["IMMEDIATE", "WATCH", "ROUTINE"] },
    capability_candidate: { type: "boolean" },
    evidence: {
      type: "array",
      minItems: 1,
      maxItems: 2,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["source", "text"],
        properties: {
          source: { type: "string", enum: ["title", "body"] },
          text: { type: "string", minLength: 1, maxLength: 120 },
        },
      },
    },
  },
  };
}

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

function cleanClause(value: string | null): string | null {
  if (!value) return null;
  let cleaned = value.trim().replace(/\s+/gu, " ").replace(/[。；;，,\s]+$/gu, "");
  const danglingEnding = /(?:的|地|得|与|及|和|或|并|以及|同时|用于|通过|基于|包括|例如|仅拉取|只拉取)$/u;
  while (danglingEnding.test(cleaned)) {
    cleaned = cleaned.replace(danglingEnding, "").replace(/[。；;，,\s]+$/gu, "");
  }
  return cleaned || null;
}

function assertCompleteClause(value: string | null, path: string): void {
  if (!value) return;
  const brokenTechnicalToken = /[A-Za-z]\?$/u;
  if (brokenTechnicalToken.test(value)) {
    throw new z.ZodError([{ code: "custom", path: [path], message: "Clause ends with an incomplete phrase or technical token" }]);
  }
}

function composeStructuredSummary(output: z.infer<typeof modelOutputSchema>): string {
  const subject = cleanClause(output.subject_zh);
  const problem = cleanClause(output.problem_zh);
  const request = cleanClause(output.request_zh);
  const change = cleanClause(output.change_zh);
  const impact = cleanClause(output.impact_zh);
  assertCompleteClause(subject, "subject_zh");
  assertCompleteClause(problem, "problem_zh");
  assertCompleteClause(request, "request_zh");
  assertCompleteClause(change, "change_zh");
  assertCompleteClause(impact, "impact_zh");
  const candidates = output.kind === "problem"
    ? [
        subject && problem && impact ? `${subject}：${problem}；${impact}` : null,
        subject && problem ? `${subject}：${problem}` : null,
        problem && impact ? `${problem}；${impact}` : null,
        problem,
      ]
    : output.kind === "request"
      ? [request && impact ? `请求${request}；${impact}` : null, request ? `请求${request}` : null]
      : [
          change && problem && impact ? `${change}，解决${problem}；${impact}` : null,
          change && problem ? `${change}，解决${problem}` : null,
          change && impact ? `${change}；${impact}` : null,
          change,
        ];
  const summary = candidates.find((candidate): candidate is string => candidate !== null && [...candidate].length <= 2000);
  if (!summary) throw new z.ZodError([{ code: "custom", path: ["summary_zh"], message: "No complete summary composition fits within 2000 characters" }]);
  return summary;
}

function toSummary(output: z.infer<typeof modelOutputSchema>, now: string, truncated: boolean): Summary {
  return summarySchema.parse({
    headlineZh: output.headline_zh,
    summaryZh: composeStructuredSummary(output),
    models: output.models,
    hardware: output.hardware,
    scenarios: output.scenarios,
    category: output.category,
    severity: output.severity,
    impactScopeZh: output.impact_scope_zh,
    attention: output.attention,
    capabilityCandidate: output.capability_candidate,
    evidence: output.evidence.map((entry) => `【${entry.source === "title" ? "标题" : "正文"}】${entry.text}`),
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
  categories: CategoryConfig,
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
        text: { verbosity: "low", format: { type: "json_schema", name: "glm_activity_summary", strict: true, schema: jsonSchemaFor(categories, candidate.type) } },
      });
      inputTokens += response.usage?.input_tokens ?? 0;
      outputTokens += response.usage?.output_tokens ?? 0;
      const parsed = modelOutputSchema.parse(JSON.parse(response.output_text));
      if (candidate.type === "pr" && parsed.kind !== "change") {
        throw new z.ZodError([{ code: "custom", path: ["kind"], message: `Kind ${parsed.kind} is not valid for ${candidate.type}` }]);
      }
      if (!isCategoryAllowedForType(categories, candidate.type, parsed.category)) {
        throw new z.ZodError([{ code: "custom", path: ["category"], message: `Category ${parsed.category} is not allowed for ${candidate.type}` }]);
      }
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
  // Retry policy is owned by summarizeCandidate. Disabling SDK retries keeps
  // one unavailable endpoint from silently multiplying the request timeout.
  const client = new OpenAI({
    apiKey,
    timeout: OPENAI_REQUEST_TIMEOUT_MS,
    maxRetries: 0,
  });
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

export function isSummaryContentError(error: unknown): boolean {
  return error instanceof SyntaxError || error instanceof z.ZodError;
}
