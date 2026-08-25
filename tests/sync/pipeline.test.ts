import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { describe, expect, test } from "vitest";
import { loadProjectConfig } from "../../src/lib/config/load";
import {
  AI_SUMMARY_CONCURRENCY,
  GITHUB_SYNC_CONCURRENCY,
  mapWithConcurrency,
  migrationFallbackSummary,
  orderSummaryCandidates,
  reusableSummary,
  runSyncPipeline,
} from "../../scripts/sync/pipeline";
import type { ActivityItem } from "../../src/lib/domain/types";
import type { ResponsesClient } from "../../scripts/sync/openai";
import type { GitHubGateway } from "../../scripts/sync/types";

const fixtures = resolve(import.meta.dirname, "../../fixtures/bootstrap-data");

async function dataCopy() {
  const root = await mkdtemp(join(tmpdir(), "glm-pipeline-"));
  await cp(fixtures, root, { recursive: true });
  return root;
}

const emptyGateway: GitHubGateway = {
  async listIssuesPage() {
    return { items: [], hasNextPage: false, rateLimit: { remaining: 4999, resetAt: "2026-08-20T12:00:00.000Z" } };
  },
  async getPull() {
    throw new Error("not expected");
  },
};

function singleEligibleGateway(itemCount = 1): GitHubGateway {
  return {
    async listIssuesPage({ repo, sort }) {
      return {
        items: repo === "vllm" && sort === "updated" ? Array.from({ length: itemCount }, (_, index) => ({
          node_id: `DAILY_BUDGET_ITEM_${index + 1}`,
          number: 903 + index,
          title: "Fix GLM inference output",
          body: "GLM output is incorrect on GPU inference.",
          html_url: `https://github.com/vllm-project/vllm/issues/${903 + index}`,
          state: "open" as const,
          created_at: "2026-08-21T00:10:00.000Z",
          updated_at: `2026-08-21T00:${20 + index}:00.000Z`,
          user: { login: "tester" },
          labels: [{ name: "glm" }],
        })) : [],
        hasNextPage: false,
        rateLimit: { remaining: 4999, resetAt: "2026-08-21T12:00:00.000Z" },
      };
    },
    async getPull() {
      throw new Error("not expected");
    },
  };
}

async function setPersistedBudget(root: string, budgetDate: string) {
  const path = join(root, "meta.json");
  const meta = JSON.parse(await readFile(path, "utf8"));
  meta.ai = {
    ...meta.ai,
    budgetDate,
    itemsSummarized: 120,
    inputTokens: 10_000,
    outputTokens: 2_000,
    estimatedCostUsd: 0.3,
  };
  await writeFile(path, `${JSON.stringify(meta, null, 2)}\n`);
}

describe("sync orchestration", () => {
  test("routes each repository through its configured source and resets a changed source cursor", async () => {
    const root = await dataCopy();
    const manifestPath = join(root, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.sources["Ascend/MindSpeed-LLM"] = { provider: "github", slug: "Ascend/MindSpeed-LLM" };
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const githubRepositories: string[] = [];
    const gitCodeRequests: Array<{ repo: string; since?: string; sort: string }> = [];
    const githubGateway: GitHubGateway = {
      async listIssuesPage(input) {
        githubRepositories.push(input.repo);
        return { items: [], hasNextPage: false, rateLimit: { remaining: 4999, resetAt: "2026-08-21T12:00:00.000Z" } };
      },
      async getPull() { throw new Error("not expected"); },
    };
    const gitCodeGateway: GitHubGateway = {
      async listIssuesPage(input) {
        gitCodeRequests.push({ repo: input.repo, since: input.since, sort: input.sort });
        return { items: [], hasNextPage: false, rateLimit: { remaining: 4999, resetAt: "2026-08-21T12:00:00.000Z" } };
      },
      async getPull() { throw new Error("not expected"); },
    };

    await runSyncPipeline({
      dataDir: root,
      gateway: githubGateway,
      sourceGateways: { github: githubGateway, gitcode: gitCodeGateway },
      now: "2026-08-21T00:30:00.000Z",
    });
    const updatedManifest = JSON.parse(await readFile(manifestPath, "utf8"));

    expect(githubRepositories).not.toContain("MindSpeed-LLM");
    expect(gitCodeRequests[0]).toEqual({
      repo: "MindSpeed-LLM",
      since: "2026-08-21T00:30:00.000Z",
      sort: "updated",
    });
    expect(gitCodeRequests.some((request) => request.sort === "created")).toBe(true);
    expect(updatedManifest.sources["Ascend/MindSpeed-LLM"]).toEqual({
      provider: "gitcode",
      slug: "Ascend/MindSpeed-LLM",
    });
  });

  test("completes every remaining backfill page for one explicitly targeted repository", async () => {
    const root = await dataCopy();
    const pages: number[] = [];
    const gitCodeGateway: GitHubGateway = {
      async listIssuesPage(input) {
        if (input.sort === "created") pages.push(input.page);
        return {
          items: [],
          hasNextPage: input.sort === "created" && input.page < 4,
          rateLimit: { remaining: 4999, resetAt: "2026-08-21T12:00:00.000Z" },
        };
      },
      async getPull() { throw new Error("not expected"); },
    };

    await runSyncPipeline({
      dataDir: root,
      sourceGateways: { gitcode: gitCodeGateway },
      repositorySlug: "Ascend/MindSpeed-LLM",
      fullSourceBackfill: true,
      now: "2026-08-21T00:30:00.000Z",
    });
    const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));

    expect(pages).toEqual([1, 2, 3, 4]);
    expect(manifest.backfill["Ascend/MindSpeed-LLM"]).toMatchObject({ status: "complete", nextPage: 5 });
  });

  test("requires an explicit repository for unbounded source backfill", async () => {
    await expect(runSyncPipeline({
      dataDir: await dataCopy(),
      gateway: emptyGateway,
      fullSourceBackfill: true,
      now: "2026-08-21T00:30:00.000Z",
    })).rejects.toThrow("fullSourceBackfill requires an explicit repositorySlug");
  });

  test("bounds concurrent work and preserves result order", async () => {
    let active = 0;
    let maximumActive = 0;
    const result = await mapWithConcurrency([30, 10, 20, 5, 15], 3, async (delay, index) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolveDelay) => setTimeout(resolveDelay, delay));
      active -= 1;
      return index;
    });

    expect(result).toEqual([0, 1, 2, 3, 4]);
    expect(maximumActive).toBe(3);
    expect(GITHUB_SYNC_CONCURRENCY).toBe(2);
    expect(AI_SUMMARY_CONCURRENCY).toBe(3);
  });

  test("reuses AI summaries unless the title or state changes", () => {
    const summary = { headlineZh: "Existing summary", promptVersion: "activity-v4-complete-brief" } as NonNullable<ActivityItem["summary"]>;
    const previous = { title: "GLM inference support", state: "open", summary } as ActivityItem;

    expect(reusableSummary(previous, { title: previous.title, state: previous.state })).toBe(summary);
    expect(reusableSummary(previous, { title: "Updated GLM inference support", state: previous.state })).toBeNull();
    expect(reusableSummary(previous, { title: previous.title, state: "closed" })).toBeNull();
    expect(reusableSummary({ ...previous, summary: null }, previous)).toBeNull();
    expect(reusableSummary({ ...previous, summary: { ...summary, promptVersion: "activity-v1" } }, previous)).toBeNull();
    expect(migrationFallbackSummary({ ...previous, summary: { ...summary, promptVersion: "activity-v1" } }, previous)).toBeTruthy();
    expect(migrationFallbackSummary(previous, { ...previous, title: "Changed title" })).toBeNull();
    expect(migrationFallbackSummary(previous, { ...previous, state: "closed" })).toBeNull();
  });

  test("keeps an old-format summary when migration is blocked by the daily limit", async () => {
    const root = await dataCopy();
    const shardPath = join(root, "items/vllm/2026/08.json");
    const shard = JSON.parse(await readFile(shardPath, "utf8"));
    const previousSummary = { ...shard[0].summary, promptVersion: "activity-v3-reader-brief" };
    shard[0].summary = previousSummary;
    await writeFile(shardPath, `${JSON.stringify(shard, null, 2)}\n`);
    await setPersistedBudget(root, "2026-08-21");

    const result = await runSyncPipeline({
      dataDir: root,
      gateway: emptyGateway,
      responsesClient: { async create() { throw new Error("not expected"); } },
      now: "2026-08-21T00:30:00.000Z",
    });
    const updatedShard = JSON.parse(await readFile(shardPath, "utf8"));

    expect(result).toMatchObject({ backlogCount: 1, summaryStopReason: "daily-item-limit" });
    expect(updatedShard[0].summary).toEqual(previousSummary);
  });

  test("summarizes new daily items, then existing daily report gaps, before historical backlog", () => {
    const candidates = [
      { nodeId: "historical", updatedAt: "2024-01-01T00:00:00.000Z" },
      { nodeId: "daily-report", updatedAt: "2026-08-21T01:00:00.000Z" },
      { nodeId: "incremental", updatedAt: "2026-08-21T02:00:00.000Z" },
    ];

    expect(orderSummaryCandidates(
      candidates,
      new Set(["incremental"]),
      new Set(["daily-report"]),
    ).map((candidate) => candidate.nodeId)).toEqual(["incremental", "daily-report", "historical"]);
  });

  test("quickly backfills GLM history through resumable issue and PR search streams", async () => {
    const root = await dataCopy();
    const searched: Array<{ repo: string; type: string; page: number }> = [];
    const gateway = {
      async listIssuesPage() {
        return { items: [], hasNextPage: false, rateLimit: { remaining: 4999, resetAt: "2026-08-21T12:00:00.000Z" } };
      },
      async searchIssuesPage({ repo, type, page }: { repo: string; type: "issue" | "pr"; page: number }) {
        searched.push({ repo, type, page });
        return {
          items: repo === "vllm" && type === "issue" && page === 1 ? [{
            node_id: "SEARCHED_VLLM",
            number: 177,
            title: "Add GLM inference support",
            body: "Historical GLM support record",
            html_url: "https://github.com/vllm-project/vllm/issues/177",
            state: "closed" as const,
            created_at: "2025-11-19T00:00:00.000Z",
            updated_at: "2025-11-20T00:00:00.000Z",
            user: { login: "tester" },
            labels: [{ name: "glm" }],
          }] : [],
          hasNextPage: false,
          rateLimit: { remaining: 29, resetAt: "2026-08-21T12:00:00.000Z" },
        };
      },
      async getPull() {
        throw new Error("not expected");
      },
    } as GitHubGateway & {
      searchIssuesPage(input: { owner: string; repo: string; type: "issue" | "pr"; page: number }): Promise<unknown>;
    };

    await runSyncPipeline({ dataDir: root, gateway, now: "2026-08-21T00:30:00.000Z" });
    const historicalShard = JSON.parse(await readFile(join(root, "items/vllm/2025/11.json"), "utf8"));
    const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
    const report = JSON.parse(await readFile(join(root, "reports/2026/08/21.json"), "utf8"));

    expect(historicalShard.map((entry: { nodeId: string }) => entry.nodeId)).toEqual(["SEARCHED_VLLM"]);
    expect(searched.filter((request) => request.repo === "vllm")).toEqual([
      { repo: "vllm", type: "issue", page: 1 },
      { repo: "vllm", type: "pr", page: 1 },
    ]);
    expect(manifest.searchBackfill["vllm-project/vllm"]).toEqual({
      status: "complete",
      type: "pr",
      nextPage: 2,
      queryVersion: "glm-title-v1",
    });
    expect(report.groups).toEqual([{ key: "daily", title: "今日动态", itemIds: [] }]);
  });

  test("does not collect a disabled repository and preserves its archived data", async () => {
    const root = await dataCopy();
    const projectConfig = await loadProjectConfig();
    projectConfig.repositories.repositories = projectConfig.repositories.repositories.map((repository) => (
      repository.slug === "vllm-project/vllm" ? { ...repository, enabled: false } : repository
    ));
    const requestedRepositories: string[] = [];
    const gateway: GitHubGateway = {
      async listIssuesPage({ owner, repo }) {
        requestedRepositories.push(`${owner}/${repo}`);
        return {
          items: [],
          hasNextPage: false,
          rateLimit: { remaining: 4999, resetAt: "2026-08-21T12:00:00.000Z" },
        };
      },
      async getPull() {
        throw new Error("not expected");
      },
    };

    await runSyncPipeline({
      dataDir: root,
      gateway,
      projectConfig,
      now: "2026-08-21T00:30:00.000Z",
    } as Parameters<typeof runSyncPipeline>[0]);
    const shard = JSON.parse(await readFile(join(root, "items/vllm/2026/08.json"), "utf8"));
    const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
    const meta = JSON.parse(await readFile(join(root, "meta.json"), "utf8"));

    expect(requestedRepositories).not.toContain("vllm-project/vllm");
    expect(shard.map((item: { nodeId: string }) => item.nodeId)).toContain("SAMPLE_VLLM");
    expect(manifest.items.SAMPLE_VLLM).toBeDefined();
    expect(manifest.cursors["vllm-project/vllm"]).toBe("2026-08-20T00:30:00.000Z");
    expect(manifest.backfill["vllm-project/vllm"]).toBeDefined();
    expect(meta.repositories.find((repository: { slug: string }) => repository.slug === "vllm-project/vllm").message).toBe("已停用，不再同步");
  });

  test("keeps the incremental cursor unchanged when a PR-detail rate limit interrupts a page", async () => {
    const root = await dataCopy();
    const manifestPath = join(root, "manifest.json");
    const startingManifest = JSON.parse(await readFile(manifestPath, "utf8"));
    startingManifest.cursors = {};
    await writeFile(manifestPath, `${JSON.stringify(startingManifest, null, 2)}\n`);
    const gateway: GitHubGateway = {
      async listIssuesPage({ repo, sort }) {
        return {
          items: repo === "LlamaFactory" && sort === "updated" ? [{
            node_id: "PARTIAL_PR_WRAPPER",
            number: 904,
            title: "Fix GLM training",
            body: "Fix GLM training.",
            html_url: "https://github.com/hiyouga/LlamaFactory/pull/904",
            state: "closed",
            created_at: "2026-08-21T00:10:00.000Z",
            updated_at: "2026-08-21T00:20:00.000Z",
            user: { login: "tester" },
            labels: [{ name: "glm" }],
            pull_request: { url: "https://api.github.com/repos/hiyouga/LlamaFactory/pulls/904" },
          }] : [],
          hasNextPage: true,
          rateLimit: { remaining: 51, resetAt: "2026-08-21T12:00:00.000Z" },
        };
      },
      async getPull() {
        return {
          item: {
            node_id: "PARTIAL_PR_DETAIL",
            number: 904,
            title: "Fix GLM training",
            body: "Fix GLM training.",
            html_url: "https://github.com/hiyouga/LlamaFactory/pull/904",
            state: "closed",
            merged_at: "2026-08-21T00:25:00.000Z",
            created_at: "2026-08-21T00:10:00.000Z",
            updated_at: "2026-08-21T00:20:00.000Z",
            user: { login: "tester" },
            labels: [{ name: "glm" }],
          },
          rateLimit: { remaining: 49, resetAt: "2026-08-21T12:00:00.000Z" },
        };
      },
    };

    const result = await runSyncPipeline({ dataDir: root, gateway, now: "2026-08-21T00:30:00.000Z" });
    const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));

    expect(result.rateLimitStop).toBe(true);
    expect(manifest.cursors["hiyouga/LlamaFactory"]).toBe("2026-08-20T00:30:00.000Z");
    expect(manifest.cursors["vllm-project/vllm"]).toBe("2026-08-20T00:30:00.000Z");
  });

  test("enforces the persisted Beijing-day item limit across workflow reruns", async () => {
    const root = await dataCopy();
    await setPersistedBudget(root, "2026-08-21");
    let openAiCalls = 0;
    const responsesClient: ResponsesClient = {
      async create() {
        openAiCalls += 1;
        throw new Error("must not be called after the daily limit");
      },
    };

    const result = await runSyncPipeline({
      dataDir: root,
      gateway: singleEligibleGateway(),
      responsesClient,
      now: "2026-08-21T00:30:00.000Z",
    });
    const meta = JSON.parse(await readFile(join(root, "meta.json"), "utf8"));

    expect(openAiCalls).toBe(0);
    expect(result).toMatchObject({ backlogCount: 1, summaryStopReason: "daily-item-limit" });
    expect(meta.ai).toMatchObject({
      budgetDate: "2026-08-21",
      itemsSummarized: 120,
      inputTokens: 10_000,
      outputTokens: 2_000,
      estimatedCostUsd: 0.3,
      stopReason: "daily-item-limit",
      lastSuccessfulCallAt: null,
    });
  });

  test("allows an explicit full summary backfill to exceed persisted software limits", async () => {
    const root = await dataCopy();
    await setPersistedBudget(root, "2026-08-21");
    let openAiCalls = 0;
    const responsesClient: ResponsesClient = {
      async create() {
        openAiCalls += 1;
        return {
          output_text: JSON.stringify({
            headline_zh: "GLM 推理问题待修复",
            kind: "problem",
            subject_zh: "GLM GPU 推理",
            problem_zh: "输出结果不正确",
            request_zh: null,
            change_zh: null,
            impact_zh: null,
            models: ["GLM"],
            hardware: ["GPU"],
            scenarios: ["INFERENCE"],
            category: "BUG",
            severity: "MEDIUM",
            impact_scope_zh: "GPU 推理",
            attention: "WATCH",
            capability_candidate: false,
            evidence: [{ source: "body", text: "GLM output is incorrect on GPU inference" }],
          }),
          usage: { input_tokens: 100, output_tokens: 50 },
        };
      },
    };

    const result = await runSyncPipeline({
      dataDir: root,
      gateway: singleEligibleGateway(),
      responsesClient,
      fullSummaryBackfill: true,
      maxAiItemsThisRun: 1,
      now: "2026-08-21T00:30:00.000Z",
    });
    const meta = JSON.parse(await readFile(join(root, "meta.json"), "utf8"));

    expect(openAiCalls).toBe(1);
    expect(result.summaryStopReason).toBeNull();
    expect(meta.ai.itemsSummarized).toBe(121);
    expect(meta.ai.estimatedCostUsd).toBeGreaterThan(0.3);
  });

  test("starts a fresh OpenAI software budget on the next Beijing day", async () => {
    const root = await dataCopy();
    await setPersistedBudget(root, "2026-08-20");
    let openAiCalls = 0;
    const responsesClient: ResponsesClient = {
      async create() {
        openAiCalls += 1;
        return {
          output_text: JSON.stringify({
            headline_zh: "GLM 推理问题待修复",
            kind: "problem",
            subject_zh: "GLM GPU 推理",
            problem_zh: "输出结果不正确",
            request_zh: null,
            change_zh: null,
            impact_zh: null,
            models: ["GLM"],
            hardware: ["GPU"],
            scenarios: ["INFERENCE"],
            category: "BUG",
            severity: "MEDIUM",
            impact_scope_zh: "GPU 推理",
            attention: "WATCH",
            capability_candidate: false,
            evidence: [{ source: "body", text: "GLM output is incorrect on GPU inference" }],
          }),
          usage: { input_tokens: 100, output_tokens: 50 },
        };
      },
    };

    await runSyncPipeline({
      dataDir: root,
      gateway: singleEligibleGateway(),
      responsesClient,
      now: "2026-08-21T00:30:00.000Z",
    });
    const meta = JSON.parse(await readFile(join(root, "meta.json"), "utf8"));

    expect(openAiCalls).toBe(1);
    expect(meta.ai).toMatchObject({
      budgetDate: "2026-08-21",
      itemsSummarized: 1,
      inputTokens: 100,
      outputTokens: 50,
    });
    expect(meta.ai.estimatedCostUsd).toBeGreaterThan(0);
  });

  test("summarizes retained body-level GLM relevance records", async () => {
    const root = await dataCopy();
    let openAiCalls = 0;
    const gateway: GitHubGateway = {
      async listIssuesPage({ repo, sort }) {
        return {
          items: repo === "vllm" && sort === "updated" ? [{
            node_id: "BODY_LEVEL_GLM",
            number: 905,
            title: "Template output mismatch",
            body: "ChatGLM responses differ from the expected template.",
            html_url: "https://github.com/vllm-project/vllm/issues/905",
            state: "open",
            created_at: "2026-08-21T00:10:00.000Z",
            updated_at: "2026-08-21T00:20:00.000Z",
            user: { login: "tester" },
            labels: [],
          }] : [],
          hasNextPage: false,
          rateLimit: { remaining: 4999, resetAt: "2026-08-21T12:00:00.000Z" },
        };
      },
      async getPull() { throw new Error("not expected"); },
    };
    const responsesClient: ResponsesClient = {
      async create() {
        openAiCalls += 1;
        return {
          output_text: JSON.stringify({
            headline_zh: "ChatGLM 模板输出不一致",
            kind: "problem",
            subject_zh: "ChatGLM 模板输出",
            problem_zh: "响应与预期模板不一致",
            request_zh: null,
            change_zh: null,
            impact_zh: null,
            models: ["ChatGLM"],
            hardware: ["UNKNOWN"],
            scenarios: ["INFERENCE"],
            category: "COMPATIBILITY",
            severity: "MEDIUM",
            impact_scope_zh: "ChatGLM 推理模板",
            attention: "WATCH",
            capability_candidate: false,
            evidence: [{ source: "body", text: "ChatGLM responses differ from the expected template" }],
          }),
          usage: { input_tokens: 100, output_tokens: 50 },
        };
      },
    };

    await runSyncPipeline({ dataDir: root, gateway, responsesClient, maxAiItemsThisRun: 1, now: "2026-08-21T00:30:00.000Z" });
    const shard = JSON.parse(await readFile(join(root, "items/vllm/2026/08.json"), "utf8"));

    expect(openAiCalls).toBe(1);
    expect(shard.find((item: { nodeId: string }) => item.nodeId === "BODY_LEVEL_GLM")?.summary).toMatchObject({ models: ["ChatGLM"] });
  });

  test("limits a live connectivity run without weakening the configured daily cap", async () => {
    const root = await dataCopy();
    let openAiCalls = 0;
    const responsesClient: ResponsesClient = {
      async create() {
        openAiCalls += 1;
        return {
          output_text: JSON.stringify({
            headline_zh: "GLM 推理问题待修复",
            kind: "problem",
            subject_zh: "GLM GPU 推理",
            problem_zh: "输出结果不正确",
            request_zh: null,
            change_zh: null,
            impact_zh: null,
            models: ["GLM"],
            hardware: ["GPU"],
            scenarios: ["INFERENCE"],
            category: "BUG",
            severity: "MEDIUM",
            impact_scope_zh: "GPU 推理",
            attention: "WATCH",
            capability_candidate: false,
            evidence: [{ source: "body", text: "GLM output is incorrect on GPU inference" }],
          }),
          usage: { input_tokens: 100, output_tokens: 50 },
        };
      },
    };

    const result = await runSyncPipeline({
      dataDir: root,
      gateway: singleEligibleGateway(2),
      responsesClient,
      maxAiItemsThisRun: 1,
      now: "2026-08-21T00:30:00.000Z",
    });
    const meta = JSON.parse(await readFile(join(root, "meta.json"), "utf8"));

    expect(openAiCalls).toBe(1);
    expect(result).toMatchObject({ summaryMode: "enabled", summaryStopReason: "run-item-limit", backlogCount: 1 });
    expect(meta.ai).toMatchObject({ itemsSummarized: 1, inputTokens: 100, outputTokens: 50, stopReason: "run-item-limit" });
  });

  test("rejects a per-run AI limit above the configured daily limit", async () => {
    const root = await dataCopy();
    await expect(runSyncPipeline({
      dataDir: root,
      gateway: emptyGateway,
      responsesClient: { async create() { throw new Error("not expected"); } },
      maxAiItemsThisRun: 121,
      now: "2026-08-21T00:30:00.000Z",
    })).rejects.toThrow("maxAiItemsThisRun must be between 1 and the configured daily item limit");
  });

  test("reports an explicit GitHub-only mode when the OpenAI key is missing", async () => {
    const root = await dataCopy();
    const result = await runSyncPipeline({ dataDir: root, gateway: emptyGateway, now: "2026-08-21T00:30:00.000Z" });
    const meta = JSON.parse(await readFile(join(root, "meta.json"), "utf8"));

    expect(result).toMatchObject({
      summaryMode: "github-only",
      summaryStopReason: "openai-key-missing",
    });
    expect(meta.ai.stopReason).toBe("openai-key-missing");
  });

  test("keeps previously collected unsummarized items in the OpenAI backlog", async () => {
    const root = await dataCopy();
    const shardPath = join(root, "items/vllm/2026/08.json");
    const shard = JSON.parse(await readFile(shardPath, "utf8"));
    shard[0].summary = null;
    await writeFile(shardPath, `${JSON.stringify(shard, null, 2)}\n`);

    const result = await runSyncPipeline({ dataDir: root, gateway: emptyGateway, now: "2026-08-21T00:30:00.000Z" });
    const meta = JSON.parse(await readFile(join(root, "meta.json"), "utf8"));
    const migratedShard = JSON.parse(await readFile(shardPath, "utf8"));

    expect(result.backlogCount).toBe(1);
    expect(meta.ai.backlogCount).toBe(1);
    expect(migratedShard[0]).toMatchObject({ category: "FIX", categorySource: "rules" });
  });

  test("removes an enabled-repository record that no longer passes the relevance rules", async () => {
    const root = await dataCopy();
    const shardPath = join(root, "items/vllm/2026/08.json");
    const shard = JSON.parse(await readFile(shardPath, "utf8"));
    shard[0] = { ...shard[0], title: "Qwen performance change", bodyExcerpt: "No tracked model is affected.", labels: [] };
    await writeFile(shardPath, `${JSON.stringify(shard, null, 2)}\n`);

    await runSyncPipeline({ dataDir: root, gateway: emptyGateway, now: "2026-08-21T00:30:00.000Z" });
    const migratedShard = JSON.parse(await readFile(shardPath, "utf8"));
    const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));

    expect(migratedShard).toEqual([]);
    expect(manifest.items.SAMPLE_VLLM).toBeUndefined();
  });

  test("stops later OpenAI calls after an unavailable-key failure and still publishes GitHub data", async () => {
    const root = await dataCopy();
    let openAiCalls = 0;
    const responsesClient: ResponsesClient = {
      async create() {
        openAiCalls += 1;
        throw Object.assign(new Error("Unauthorized"), { status: 401 });
      },
    };
    const gateway: GitHubGateway = {
      async listIssuesPage({ repo, sort }) {
        return {
          items: repo === "vllm" && sort === "updated" ? [
            {
              node_id: "OPENAI_UNAVAILABLE_1",
              number: 901,
              title: "Fix GLM inference output",
              body: "GLM output is incorrect on GPU inference.",
              html_url: "https://github.com/vllm-project/vllm/issues/901",
              state: "open",
              created_at: "2026-08-21T00:10:00.000Z",
              updated_at: "2026-08-21T00:20:00.000Z",
              user: { login: "tester" },
              labels: [{ name: "glm" }],
            },
            {
              node_id: "OPENAI_UNAVAILABLE_2",
              number: 902,
              title: "Add GLM training support",
              body: "Enable GLM training on GPU.",
              html_url: "https://github.com/vllm-project/vllm/issues/902",
              state: "open",
              created_at: "2026-08-21T00:11:00.000Z",
              updated_at: "2026-08-21T00:21:00.000Z",
              user: { login: "tester" },
              labels: [{ name: "glm" }],
            },
          ] : [],
          hasNextPage: false,
          rateLimit: { remaining: 4999, resetAt: "2026-08-21T12:00:00.000Z" },
        };
      },
      async getPull() {
        throw new Error("not expected");
      },
    };

    const result = await runSyncPipeline({
      dataDir: root,
      gateway,
      responsesClient,
      now: "2026-08-21T00:30:00.000Z",
    });
    const shard = JSON.parse(await readFile(join(root, "items/vllm/2026/08.json"), "utf8"));
    const meta = JSON.parse(await readFile(join(root, "meta.json"), "utf8"));

    expect(openAiCalls).toBe(2);
    expect(result).toMatchObject({
      published: 2,
      backlogCount: 2,
      summaryMode: "github-only",
      summaryStopReason: "openai-unavailable",
    });
    expect(shard.filter((item: { nodeId: string }) => item.nodeId.startsWith("OPENAI_UNAVAILABLE"))).toHaveLength(2);
    expect(meta.ai.stopReason).toBe("openai-unavailable");
  });

  test("dry-run reports collection without writing files", async () => {
    const root = await dataCopy();
    const before = await readFile(join(root, "meta.json"), "utf8");
    const result = await runSyncPipeline({ dataDir: root, gateway: emptyGateway, now: "2026-08-21T00:30:00.000Z", dryRun: true });

    expect(result.collected).toBe(0);
    expect(await readFile(join(root, "meta.json"), "utf8")).toBe(before);
  });

  test("omits the updated-since filter from created-order historical backfill", async () => {
    const root = await dataCopy();
    const historicalSinceValues: Array<string | undefined> = [];
    const gateway: GitHubGateway = {
      async listIssuesPage({ sort, since }) {
        if (sort === "created") historicalSinceValues.push(since);
        return {
          items: [],
          hasNextPage: false,
          rateLimit: { remaining: 4999, resetAt: "2026-08-21T12:00:00.000Z" },
        };
      },
      async getPull() {
        throw new Error("not expected");
      },
    };

    await runSyncPipeline({ dataDir: root, gateway, now: "2026-08-21T00:30:00.000Z" });

    expect(historicalSinceValues).toEqual([undefined, undefined, undefined, undefined]);
  });

  test("repeated empty syncs remain duplicate-free", async () => {
    const root = await dataCopy();
    await runSyncPipeline({ dataDir: root, gateway: emptyGateway, now: "2026-08-21T00:30:00.000Z" });
    await runSyncPipeline({ dataDir: root, gateway: emptyGateway, now: "2026-08-21T00:31:00.000Z" });
    const shardFiles = [
      "items/llamafactory/2026/08.json",
      "items/mindspeed-llm/2026/08.json",
      "items/verl/2026/08.json",
      "items/vllm/2026/08.json",
    ];
    const shard = (await Promise.all(shardFiles.map(async (path) => JSON.parse(await readFile(join(root, path), "utf8"))))).flat();

    expect(shard).toHaveLength(4);
    expect(new Set(shard.map((entry: { nodeId: string }) => entry.nodeId)).size).toBe(4);
  });

  test("advances bounded backfill pages independently from incremental collection", async () => {
    const root = await dataCopy();
    const requests: Array<{ repo: string; page: number; sort: string }> = [];
    const gateway: GitHubGateway = {
      async listIssuesPage({ repo, page, sort }) {
        requests.push({ repo, page, sort });
        return {
          items: [],
          hasNextPage: sort === "created",
          rateLimit: { remaining: 4999, resetAt: "2026-08-21T12:00:00.000Z" },
        };
      },
      async getPull() {
        throw new Error("not expected");
      },
    };

    await runSyncPipeline({ dataDir: root, gateway, now: "2026-08-21T00:30:00.000Z" });
    const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));

    expect(requests.filter((request) => request.repo === "vllm" && request.sort === "created").map((request) => request.page)).toEqual([1, 2]);
    expect(manifest.backfill["vllm-project/vllm"]).toEqual({
      status: "running",
      nextPage: 3,
      historyStartAt: "1970-01-01T00:00:00.000Z",
    });
    expect(manifest.cursors["vllm-project/vllm"]).toBe("2026-08-21T00:30:00.000Z");
  });

  test("stores historical backfill without adding it to today's report", async () => {
    const root = await dataCopy();
    const gateway: GitHubGateway = {
      async listIssuesPage({ repo, sort }) {
        return {
          items: repo === "vllm" && sort === "created" ? [{
            node_id: "HISTORICAL_VLLM",
            number: 77,
            title: "Add GLM inference support",
            body: "Historical GLM support record",
            html_url: "https://github.com/vllm-project/vllm/issues/77",
            state: "closed",
            created_at: "2024-11-19T00:00:00.000Z",
            updated_at: "2024-11-20T00:00:00.000Z",
            user: { login: "tester" },
            labels: [{ name: "glm" }],
          }] : [],
          hasNextPage: false,
          rateLimit: { remaining: 4999, resetAt: "2026-08-21T12:00:00.000Z" },
        };
      },
      async getPull() {
        throw new Error("not expected");
      },
    };

    await runSyncPipeline({ dataDir: root, gateway, now: "2026-08-21T00:30:00.000Z" });
    const historicalShard = JSON.parse(await readFile(join(root, "items/vllm/2024/11.json"), "utf8"));
    const report = JSON.parse(await readFile(join(root, "reports/2026/08/21.json"), "utf8"));

    expect(historicalShard.map((entry: { nodeId: string }) => entry.nodeId)).toEqual(["HISTORICAL_VLLM"]);
    expect(report.groups).toEqual([{ key: "daily", title: "今日动态", itemIds: [] }]);
  });

  test("publishes only incremental records into the daily report", async () => {
    const root = await dataCopy();
    const gateway: GitHubGateway = {
      async listIssuesPage({ repo, sort }) {
        return {
          items: repo === "vllm" && sort === "updated" ? [{
            node_id: "TODAY_VLLM",
            number: 88,
            title: "Fix GLM inference output",
            body: "Today's GLM fix",
            html_url: "https://github.com/vllm-project/vllm/issues/88",
            state: "open",
            created_at: "2026-08-21T00:10:00.000Z",
            updated_at: "2026-08-21T00:20:00.000Z",
            user: { login: "tester" },
            labels: [{ name: "glm" }],
          }] : [],
          hasNextPage: false,
          rateLimit: { remaining: 4999, resetAt: "2026-08-21T12:00:00.000Z" },
        };
      },
      async getPull() {
        throw new Error("not expected");
      },
    };

    await runSyncPipeline({ dataDir: root, gateway, now: "2026-08-21T00:30:00.000Z" });
    const report = JSON.parse(await readFile(join(root, "reports/2026/08/21.json"), "utf8"));

    expect(report.intro).toBe("今日新增或更新 1 条 GLM 相关动态：1 个 Issue，0 个 PR。");
    expect(report.groups).toEqual([{ key: "daily", title: "今日动态", itemIds: ["vllm-issue-88"] }]);
  });
});
