import { describe, expect, test } from "vitest";
import { summarizeCandidate } from "../../scripts/sync/openai";
import type { ResponsesClient } from "../../scripts/sync/openai";
import type { NormalizedCandidate } from "../../scripts/sync/types";

const candidate: NormalizedCandidate = {
  id: "vllm-pr-1",
  nodeId: "PR_1",
  repository: "vllm-project/vllm",
  number: 1,
  type: "pr",
  title: "Fix GLM inference",
  bodyExcerpt: "Correct output token alignment.",
  author: "alice",
  state: "merged",
  labels: ["model"],
  url: "https://github.com/vllm-project/vllm/pull/1",
  createdAt: "2026-08-20T00:00:00.000Z",
  updatedAt: "2026-08-20T01:00:00.000Z",
  mergedAt: "2026-08-20T01:00:00.000Z",
  firstSeenAt: "2026-08-20T01:01:00.000Z",
  contentHash: "sha256:x",
};

const config = {
  model: "gpt-5.6-luna" as const,
  reasoningEffort: "none" as const,
  itemMaxInputTokens: 8000,
  itemMaxOutputTokens: 800,
  maxRetries: 1,
};

const output = JSON.stringify({
  headline_zh: "推理输出一致性修复已合并",
  summary_zh: "该变更修复了 GLM 推理输出 token 对齐问题。",
  models: ["GLM"],
  hardware: ["GPU"],
  scenarios: ["INFERENCE"],
  category: "FIX",
  severity: "MEDIUM",
  impact_scope_zh: "GPU 推理输出",
  attention: "WATCH",
  capability_candidate: true,
  evidence: ["Correct output token alignment"],
});

describe("constrained OpenAI summarization", () => {
  test("sends the approved stateless, tool-free structured request", async () => {
    let request: Record<string, unknown> | undefined;
    const client: ResponsesClient = {
      async create(input) {
        request = input;
        return { output_text: output, usage: { input_tokens: 120, output_tokens: 80 } };
      },
    };

    const result = await summarizeCandidate(client, candidate, config, "2026-08-20T02:00:00.000Z");

    expect(request).toMatchObject({
      model: "gpt-5.6-luna",
      reasoning: { effort: "none" },
      tools: [],
      store: false,
      max_output_tokens: 800,
      text: { format: { type: "json_schema", name: "glm_activity_summary", strict: true } },
    });
    expect(result.summary).toMatchObject({ headlineZh: "推理输出一致性修复已合并", category: "FIX" });
    expect(result.usage).toEqual({ inputTokens: 120, outputTokens: 80 });
  });

  test("retries malformed structured output once without changing models", async () => {
    const models: unknown[] = [];
    const client: ResponsesClient = {
      async create(input) {
        models.push(input.model);
        return {
          output_text: models.length === 1 ? "{}" : output,
          usage: { input_tokens: 100, output_tokens: 60 },
        };
      },
    };

    await expect(
      summarizeCandidate(client, candidate, config, "2026-08-20T02:00:00.000Z"),
    ).resolves.toBeDefined();
    expect(models).toEqual(["gpt-5.6-luna", "gpt-5.6-luna"]);
  });
});
