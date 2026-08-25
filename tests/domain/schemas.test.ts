import { describe, expect, test } from "vitest";
import {
  activityItemSchema,
  capabilityConfigSchema,
  dailyReportSchema,
  manifestSchema,
  openAiConfigSchema,
  repositoryConfigSchema,
  searchDocumentSchema,
} from "../../src/lib/domain/schemas";

const timestamp = "2026-08-20T00:30:00.000Z";

describe("runtime data contracts", () => {
  test("accepts exactly the four unique initial repositories", () => {
    const result = repositoryConfigSchema.safeParse({
      schemaVersion: 1,
      repositories: [
        ["hiyouga/LlamaFactory", "LLaMA-Factory"],
        ["Ascend/MindSpeed-LLM", "MindSpeed-LLM"],
        ["volcengine/verl", "verl"],
        ["vllm-project/vllm", "vLLM"],
      ].map(([slug, framework], index) => ({
        slug,
        source: { provider: index === 1 ? "gitcode" : "github", slug },
        dataKey: ["llamafactory", "mindspeed-llm", "verl", "vllm"][index],
        historyStartAt: "1970-01-01T00:00:00.000Z",
        backfillPageLimit: 2,
        framework,
        enabled: true,
        defaultBranch: "main",
        color: "#8b5e3c",
        keywords: [],
      })),
    });

    expect(result.success).toBe(true);
    expect(
      repositoryConfigSchema.safeParse({
        schemaVersion: 1,
        repositories: result.data?.repositories.map((repository) => ({ ...repository, backfillPageLimit: 3 })) ?? [],
      }).success,
    ).toBe(false);
    expect(result.data?.repositories[1]?.source?.provider).toBe("gitcode");
  });

  test("rejects duplicate repository slugs", () => {
    const repository = {
      slug: "hiyouga/LlamaFactory",
      dataKey: "llamafactory",
      historyStartAt: "1970-01-01T00:00:00.000Z",
      backfillPageLimit: 2,
      framework: "LLaMA-Factory",
      enabled: true,
      defaultBranch: "main",
      color: "#8b5e3c",
      keywords: [],
    };

    expect(
      repositoryConfigSchema.safeParse({
        schemaVersion: 1,
        repositories: [repository, repository],
      }).success,
    ).toBe(false);
  });

  test("enforces the single approved OpenAI model and positive limits", () => {
    const valid = {
      model: "gpt-5.6-luna",
      reasoningEffort: "none",
      dailyItemLimit: 120,
      dailyBudgetUsd: 0.35,
      safetyMarginPercent: 10,
      itemMaxInputTokens: 8000,
      itemMaxOutputTokens: 800,
      reportMaxInputTokens: 12000,
      reportMaxOutputTokens: 1200,
      maxRetries: 1,
      rpm: 30,
      tpm: 150000,
      pricingUsdPerMillionTokens: { input: 0.2, output: 1.2 },
    };

    expect(openAiConfigSchema.safeParse(valid).success).toBe(true);
    expect(
      openAiConfigSchema.safeParse({ ...valid, model: "gpt-5.6" }).success,
    ).toBe(false);
    expect(
      openAiConfigSchema.safeParse({ ...valid, dailyBudgetUsd: 0 }).success,
    ).toBe(false);
  });

  test("accepts a traceable activity item and rejects oversized excerpts", () => {
    const item = {
      id: "vllm-project-vllm-pr-123",
      nodeId: "PR_kwDOA123",
      repository: "vllm-project/vllm",
      number: 123,
      type: "pr",
      title: "Add GLM support",
      bodyExcerpt: "Public upstream excerpt",
      author: "octocat",
      state: "merged",
      labels: ["model"],
      url: "https://github.com/vllm-project/vllm/pull/123",
      createdAt: timestamp,
      updatedAt: timestamp,
      mergedAt: timestamp,
      firstSeenAt: timestamp,
      contentHash: "sha256:abc",
      summary: null,
    };

    expect(activityItemSchema.safeParse(item).success).toBe(true);
    expect(
      activityItemSchema.safeParse({ ...item, bodyExcerpt: "字".repeat(2001) })
        .success,
    ).toBe(false);
    expect(
      activityItemSchema.safeParse({ ...item, url: "https://example.com/123" })
        .success,
    ).toBe(false);
  });

  test("validates reports, capabilities, manifests, and search documents", () => {
    expect(
      dailyReportSchema.safeParse({
        date: "2026-08-20",
        intro: "今日 GLM 生态有一项变化。",
        groups: [{ key: "fixes", title: "修复", itemIds: ["item-1"] }],
        completeness: "complete",
        model: "gpt-5.6-luna",
        promptVersion: "v1",
        createdAt: timestamp,
        updatedAt: timestamp,
      }).success,
    ).toBe(true);

    expect(
      capabilityConfigSchema.safeParse({
        schemaVersion: 1,
        entries: [
          {
            id: "vllm-glm4-gpu-inference",
            framework: "vLLM",
            model: "GLM-4",
            hardware: "GPU",
            scenario: "INFERENCE",
            capability: "基础推理",
            status: "unknown",
            minimumVersion: null,
            limitations: "待社区证据核实",
            verifiedAt: "2026-08-20",
            evidence: ["https://github.com/vllm-project/vllm"],
          },
        ],
      }).success,
    ).toBe(true);

    expect(
      manifestSchema.safeParse({
        schemaVersion: 1,
        items: {
          PR_kwDOA123: {
            shard: "items/vllm/2026/08.json",
            contentHash: "sha256:abc",
            summaryHash: null,
            updatedAt: timestamp,
          },
        },
        cursors: { "vllm-project/vllm": timestamp },
        backfill: {
          "vllm-project/vllm": {
            status: "running",
            nextPage: 2,
            historyStartAt: timestamp,
          },
        },
      }).success,
    ).toBe(true);

    expect(
      searchDocumentSchema.safeParse({
        id: "item-1",
        title: "GLM fix",
        summary: "修复摘要",
        repository: "vllm-project/vllm",
        type: "pr",
        state: "merged",
        category: "FIX",
        updatedAt: timestamp,
        url: "https://github.com/vllm-project/vllm/pull/123",
        models: ["GLM-4"],
      }).success,
    ).toBe(true);
  });
});
