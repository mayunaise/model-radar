import { describe, expect, test } from "vitest";
import { summarizeCandidate } from "../../scripts/sync/openai";
import type { ResponsesClient } from "../../scripts/sync/openai";
import type { NormalizedCandidate } from "../../scripts/sync/types";
import type { CategoryConfig } from "../../src/lib/domain/types";

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

const categories: CategoryConfig = {
  schemaVersion: 1,
  categories: [
    { code: "NEW_SUPPORT", appliesTo: ["issue", "pr"], labels: { issue: "支持诉求", pr: "新增支持" }, order: 10 },
    { code: "BUG", appliesTo: ["issue"], labels: { issue: "Bug" }, order: 20 },
    { code: "FIX", appliesTo: ["pr"], labels: { pr: "Bug 修复" }, order: 20 },
    { code: "PERFORMANCE", appliesTo: ["issue", "pr"], labels: { issue: "性能问题", pr: "性能优化" }, order: 30 },
    { code: "DOCS", appliesTo: ["issue", "pr"], labels: { issue: "文档问题", pr: "文档更新" }, order: 40 },
    { code: "COMPATIBILITY", appliesTo: ["issue", "pr"], labels: { issue: "兼容性", pr: "兼容性适配" }, order: 50 },
    { code: "OTHER", appliesTo: ["issue", "pr"], labels: { issue: "其他", pr: "其他" }, order: 60 },
  ],
};

const output = JSON.stringify({
  headline_zh: "推理输出一致性修复已合并",
  kind: "change",
  subject_zh: "GLM 推理输出",
  problem_zh: "token 对齐错误",
  request_zh: null,
  change_zh: "修复 token 对齐逻辑",
  impact_zh: null,
  models: ["GLM"],
  hardware: ["GPU"],
  scenarios: ["INFERENCE"],
  category: "FIX",
  severity: "MEDIUM",
  impact_scope_zh: "GPU 推理输出",
  attention: "WATCH",
  capability_candidate: true,
  evidence: [{ source: "body", text: "Correct output token alignment" }],
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

    const result = await summarizeCandidate(client, candidate, config, "2026-08-20T02:00:00.000Z", categories);

    expect(request).toMatchObject({
      model: "gpt-5.6-luna",
      reasoning: { effort: "none" },
      tools: [],
      store: false,
      max_output_tokens: 800,
      text: { verbosity: "low", format: { type: "json_schema", name: "glm_activity_summary", strict: true } },
    });
    const categoryEnum = (((request?.text as { format: { schema: { properties: { category: { enum: string[] } } } } }).format.schema.properties.category.enum));
    expect(categoryEnum).toEqual(["NEW_SUPPORT", "FIX", "PERFORMANCE", "DOCS", "COMPATIBILITY", "OTHER"]);
    const schemaProperties = ((request?.text as { format: { schema: { properties: Record<string, unknown> } } }).format.schema.properties);
    expect(schemaProperties).toHaveProperty("kind");
    expect(schemaProperties).toHaveProperty("subject_zh");
    expect(schemaProperties).toHaveProperty("problem_zh");
    expect(schemaProperties).toHaveProperty("request_zh");
    expect(schemaProperties).toHaveProperty("change_zh");
    expect(schemaProperties).toHaveProperty("impact_zh");
    expect(schemaProperties).not.toHaveProperty("summary_zh");
    expect(result.summary).toMatchObject({
      headlineZh: "推理输出一致性修复已合并",
      summaryZh: "修复 token 对齐逻辑，解决token 对齐错误",
      category: "FIX",
      promptVersion: "activity-v4-complete-brief",
    });
    expect([...result.summary.summaryZh].length).toBeLessThanOrEqual(2000);
    expect(result.usage).toEqual({ inputTokens: 120, outputTokens: 80 });
  });

  test("drops secondary clauses instead of cutting a summary mid-sentence", async () => {
    const verboseOutput = JSON.stringify({
      ...JSON.parse(output),
      problem_zh: "现".repeat(60),
      change_zh: "解".repeat(60),
    });
    const client: ResponsesClient = {
      async create() {
        return { output_text: verboseOutput, usage: { input_tokens: 120, output_tokens: 80 } };
      },
    };

    const result = await summarizeCandidate(client, candidate, config, "2026-08-20T02:00:00.000Z", categories);

    expect(result.summary.summaryZh).toBe(`${"解".repeat(60)}，解决${"现".repeat(60)}`);
    expect([...result.summary.summaryZh].length).toBeLessThanOrEqual(2000);
    expect(result.summary.summaryZh.endsWith("…")).toBe(false);
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
      summarizeCandidate(client, candidate, config, "2026-08-20T02:00:00.000Z", categories),
    ).resolves.toBeDefined();
    expect(models).toEqual(["gpt-5.6-luna", "gpt-5.6-luna"]);
  });

  test("removes dangling connective words instead of publishing a fragment", async () => {
    let calls = 0;
    const incompleteOutput = JSON.stringify({
      ...JSON.parse(output),
      change_zh: "新增查询复制选项，同时用于",
    });
    const client: ResponsesClient = {
      async create() {
        calls += 1;
        return { output_text: incompleteOutput, usage: { input_tokens: 100, output_tokens: 60 } };
      },
    };

    const result = await summarizeCandidate(client, candidate, config, "2026-08-20T02:00:00.000Z", categories);

    expect(calls).toBe(1);
    expect(result.summary.summaryZh).toBe("新增查询复制选项，解决token 对齐错误");
  });

  test("allows an issue to document a completed upstream change", async () => {
    const issueOutput = JSON.stringify({
      ...JSON.parse(output),
      kind: "change",
      category: "COMPATIBILITY",
      change_zh: "新增 MLA 模型的流水线并行支持",
      problem_zh: null,
    });
    const client: ResponsesClient = {
      async create() {
        return { output_text: issueOutput, usage: { input_tokens: 100, output_tokens: 60 } };
      },
    };

    const result = await summarizeCandidate(
      { ...client },
      { ...candidate, type: "issue", id: "vllm-issue-2", url: "https://github.com/vllm-project/vllm/issues/2" },
      config,
      "2026-08-20T02:00:00.000Z",
      categories,
    );

    expect(result.summary.summaryZh).toBe("新增 MLA 模型的流水线并行支持");
  });
});
