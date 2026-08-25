import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, test, vi } from "vitest";
import { collectRepositoryPage, collectRepositorySearchPage, createGitHubGateway } from "../../scripts/sync/github";
import type { GitHubGateway } from "../../scripts/sync/types";

const octokit = vi.hoisted(() => ({
  listForRepo: vi.fn(),
  getPull: vi.fn(),
  graphql: vi.fn(),
  searchIssuesAndPullRequests: vi.fn(),
  constructorOptions: [] as unknown[],
}));

vi.mock("@octokit/rest", () => ({
  Octokit: class {
    constructor(options: unknown) {
      octokit.constructorOptions.push(options);
    }
    rest = {
      issues: { listForRepo: octokit.listForRepo },
      pulls: { get: octokit.getPull },
      search: { issuesAndPullRequests: octokit.searchIssuesAndPullRequests },
    };
    graphql = octokit.graphql;
  },
}));

const fixtures = resolve(import.meta.dirname, "../fixtures/github");

describe("GitHub collection boundary", () => {
  test("expands a page of PR wrappers with one batch request", async () => {
    const pull = JSON.parse(await readFile(resolve(fixtures, "pull.json"), "utf8"));
    let batchCalls = 0;
    let detailCalls = 0;
    const gateway: GitHubGateway = {
      async listIssuesPage() {
        return {
          items: [
            { ...pull, node_id: "WRAPPER_11", number: 11, pull_request: { url: "https://api.github.com/pulls/11" } },
            { ...pull, node_id: "WRAPPER_12", number: 12, pull_request: { url: "https://api.github.com/pulls/12" } },
          ],
          hasNextPage: false,
          rateLimit: { remaining: 4998, resetAt: "2026-08-20T05:00:00.000Z" },
        };
      },
      async getPulls() {
        batchCalls += 1;
        return {
          details: [
            { number: 11, nodeId: "PR_BATCH_11", state: "merged" as const, mergedAt: "2026-08-20T04:00:00.000Z" },
            { number: 12, nodeId: "PR_BATCH_12", state: "open" as const, mergedAt: null },
          ],
          rateLimit: { remaining: 4900, resetAt: "2026-08-20T05:00:00.000Z" },
        };
      },
      async getPull() {
        detailCalls += 1;
        throw new Error("batch path must not call individual PR details");
      },
    };

    const result = await collectRepositoryPage(
      gateway,
      {
        slug: "vllm-project/vllm",
        dataKey: "vllm",
        historyStartAt: "1970-01-01T00:00:00.000Z",
        backfillPageLimit: 2,
        framework: "vLLM",
        enabled: true,
        defaultBranch: "main",
        color: "#B18438",
        keywords: [],
      },
      { since: "2026-08-20T00:00:00.000Z", page: 1, sort: "updated", direction: "asc" },
      "2026-08-20T05:00:00.000Z",
    );

    expect(batchCalls).toBe(1);
    expect(detailCalls).toBe(0);
    expect(result.items.map((item) => [item.nodeId, item.state])).toEqual([
      ["PR_BATCH_11", "merged"],
      ["PR_BATCH_12", "open"],
    ]);
  });

  test("requests PR details only for candidates selected by the relevance prefilter", async () => {
    const pull = JSON.parse(await readFile(resolve(fixtures, "pull.json"), "utf8"));
    let requestedNumbers: number[] = [];
    const gateway: GitHubGateway = {
      async listIssuesPage() {
        return {
          items: [
            { ...pull, number: 11, title: "Fix GLM inference", state: "closed", merged_at: undefined, pull_request: { url: "https://api.github.com/pulls/11" } },
            { ...pull, number: 12, title: "Unrelated change", state: "closed", merged_at: undefined, pull_request: { url: "https://api.github.com/pulls/12" } },
          ],
          hasNextPage: false,
          rateLimit: { remaining: 4998, resetAt: "2026-08-20T05:00:00.000Z" },
        };
      },
      async getPulls({ numbers }) {
        requestedNumbers = numbers;
        return {
          details: [{ number: 11, nodeId: "PR_RELEVANT_11", state: "merged", mergedAt: "2026-08-20T04:00:00.000Z" }],
          rateLimit: { remaining: 4997, resetAt: "2026-08-20T05:00:00.000Z" },
        };
      },
      async getPull() {
        throw new Error("batch path must not call individual PR details");
      },
    };

    const result = await collectRepositoryPage(
      gateway,
      {
        slug: "vllm-project/vllm",
        dataKey: "vllm",
        historyStartAt: "1970-01-01T00:00:00.000Z",
        backfillPageLimit: 2,
        framework: "vLLM",
        enabled: true,
        defaultBranch: "main",
        color: "#B18438",
        keywords: [],
      },
      { since: "2026-08-20T00:00:00.000Z", page: 1, sort: "updated", direction: "asc" },
      "2026-08-20T05:00:00.000Z",
      (item) => item.title.includes("GLM"),
    );

    expect(requestedNumbers).toEqual([11]);
    expect(result.items.map((item) => [item.number, item.state])).toEqual([
      [11, "merged"],
      [12, "closed"],
    ]);
  });

  test("builds one compact GraphQL query for multiple PR states", async () => {
    octokit.graphql.mockResolvedValueOnce({
      repository: {
        pr0: { id: "PR_GRAPHQL_11", number: 11, state: "MERGED", mergedAt: "2026-08-20T04:00:00.000Z" },
        pr1: { id: "PR_GRAPHQL_12", number: 12, state: "OPEN", mergedAt: null },
      },
      rateLimit: { remaining: 4890, resetAt: "2026-08-20T05:00:00.000Z" },
    });
    const gateway = createGitHubGateway("test-token");

    const result = await gateway.getPulls?.({ owner: "vllm-project", repo: "vllm", numbers: [11, 12] });

    expect(octokit.graphql).toHaveBeenCalledTimes(1);
    expect(octokit.graphql.mock.calls[0]?.[0]).toMatch(/pr0:\s*pullRequest\(number:\s*11\)/u);
    expect(octokit.graphql.mock.calls[0]?.[0]).toMatch(/pr1:\s*pullRequest\(number:\s*12\)/u);
    expect(result?.details).toEqual([
      { number: 11, nodeId: "PR_GRAPHQL_11", state: "merged", mergedAt: "2026-08-20T04:00:00.000Z" },
      { number: 12, nodeId: "PR_GRAPHQL_12", state: "open", mergedAt: null },
    ]);
  });

  test("sets a finite request timeout and retries transient GitHub failures", async () => {
    const pull = JSON.parse(await readFile(resolve(fixtures, "pull.json"), "utf8"));
    octokit.getPull
      .mockRejectedValueOnce(Object.assign(new Error("REFUSED_STREAM"), { status: 500 }))
      .mockResolvedValueOnce({
        data: pull,
        headers: {
          "x-ratelimit-remaining": "4998",
          "x-ratelimit-reset": "1787198400",
        },
      });

    const gateway = createGitHubGateway("test-token");
    const result = await gateway.getPull({ owner: "vllm-project", repo: "vllm", number: 52405 });

    expect(octokit.constructorOptions.at(-1)).toMatchObject({
      request: { timeout: 15_000, fetch: expect.any(Function) },
    });
    expect(octokit.getPull).toHaveBeenCalledTimes(2);
    expect(octokit.getPull).toHaveBeenLastCalledWith(expect.objectContaining({
      request: { signal: expect.any(AbortSignal) },
    }));
    expect(result.item.node_id).toBe(pull.node_id);
  });

  test("searches one issue or PR stream for explicit GLM mentions", async () => {
    octokit.searchIssuesAndPullRequests.mockResolvedValueOnce({
      data: { items: [], total_count: 120 },
      headers: {
        link: '<https://api.github.com/search/issues?page=2>; rel="next"',
        "x-ratelimit-remaining": "29",
        "x-ratelimit-reset": "1787198400",
      },
    });
    const gateway = createGitHubGateway("test-token") as ReturnType<typeof createGitHubGateway> & {
      searchIssuesPage?: (input: { owner: string; repo: string; type: "issue" | "pr"; page: number }) => Promise<{
        items: unknown[];
        hasNextPage: boolean;
        rateLimit: { remaining: number };
      }>;
    };

    expect(typeof gateway.searchIssuesPage).toBe("function");
    if (!gateway.searchIssuesPage) return;
    const result = await gateway.searchIssuesPage({ owner: "vllm-project", repo: "vllm", type: "pr", page: 1 });

    expect(octokit.searchIssuesAndPullRequests).toHaveBeenCalledWith(expect.objectContaining({
      q: "repo:vllm-project/vllm GLM in:title is:pr",
      per_page: 100,
      page: 1,
      sort: "created",
      order: "asc",
      request: { signal: expect.any(AbortSignal) },
    }));
    expect(result).toMatchObject({ hasNextPage: true, rateLimit: { remaining: 29 } });
  });

  test("does not mistake the lower search quota for the core PR-detail quota", async () => {
    const pull = JSON.parse(await readFile(resolve(fixtures, "pull.json"), "utf8"));
    let pullCalls = 0;
    const gateway: GitHubGateway = {
      async listIssuesPage() {
        throw new Error("not expected");
      },
      async searchIssuesPage() {
        return {
          items: [{ ...pull, pull_request: { url: "https://api.github.com/pulls/11" } }],
          hasNextPage: false,
          rateLimit: { remaining: 29, resetAt: "2026-08-20T05:00:00.000Z" },
        };
      },
      async getPull() {
        pullCalls += 1;
        return {
          item: pull,
          rateLimit: { remaining: 4997, resetAt: "2026-08-20T05:00:00.000Z" },
        };
      },
    };

    const result = await collectRepositorySearchPage(
      gateway,
      {
        slug: "hiyouga/LlamaFactory",
        dataKey: "llamafactory",
        historyStartAt: "1970-01-01T00:00:00.000Z",
        backfillPageLimit: 2,
        framework: "LLaMA-Factory",
        enabled: true,
        defaultBranch: "main",
        color: "#A86845",
        keywords: [],
      },
      { type: "pr", page: 1 },
      "2026-08-20T05:00:00.000Z",
    );

    expect(pullCalls).toBe(1);
    expect(result.items.map((item) => item.nodeId)).toEqual(["PR_sample_11"]);
    expect(result.pageComplete).toBe(true);
  });

  test("follows the GitHub next link even when a page contains fewer than 100 records", async () => {
    octokit.listForRepo.mockResolvedValueOnce({
      data: [{ number: 1 }, { number: 2 }, { number: 3 }],
      headers: {
        link: '<https://api.github.com/repositories/1/issues?page=2>; rel="next", <https://api.github.com/repositories/1/issues?page=4>; rel="last"',
        "x-ratelimit-remaining": "4999",
        "x-ratelimit-reset": "1787198400",
      },
    });

    const result = await createGitHubGateway("test-token").listIssuesPage({
      owner: "owner",
      repo: "repository",
      since: "1970-01-01T00:00:00.000Z",
      page: 1,
      sort: "created",
      direction: "asc",
    });

    expect(result.hasNextPage).toBe(true);
  });

  test("stops pagination when GitHub omits the next link even for a full page", async () => {
    octokit.listForRepo.mockResolvedValueOnce({
      data: Array.from({ length: 100 }, (_, index) => ({ number: index + 1 })),
      headers: {
        "x-ratelimit-remaining": "4999",
        "x-ratelimit-reset": "1787198400",
      },
    });

    const result = await createGitHubGateway("test-token").listIssuesPage({
      owner: "owner",
      repo: "repository",
      since: "1970-01-01T00:00:00.000Z",
      page: 4,
      sort: "created",
      direction: "asc",
    });

    expect(result.hasNextPage).toBe(false);
  });

  test("normalizes issues and expands PR wrappers exactly once", async () => {
    const issues = JSON.parse(await readFile(resolve(fixtures, "issues.json"), "utf8"));
    const pull = JSON.parse(await readFile(resolve(fixtures, "pull.json"), "utf8"));
    const gateway: GitHubGateway = {
      async listIssuesPage() {
        return {
          items: issues,
          hasNextPage: false,
          rateLimit: { remaining: 4998, resetAt: "2026-08-20T05:00:00.000Z" },
        };
      },
      async getPull() {
        return {
          item: pull,
          rateLimit: { remaining: 4997, resetAt: "2026-08-20T05:00:00.000Z" },
        };
      },
    };

    const result = await collectRepositoryPage(
      gateway,
      {
        slug: "hiyouga/LlamaFactory",
        dataKey: "llamafactory",
        historyStartAt: "1970-01-01T00:00:00.000Z",
        backfillPageLimit: 10,
        framework: "LLaMA-Factory",
        enabled: true,
        defaultBranch: "main",
        color: "#A86845",
        keywords: [],
      },
      {
        since: "2026-08-20T00:00:00.000Z",
        page: 3,
        sort: "created",
        direction: "asc",
      },
      "2026-08-20T05:00:00.000Z",
    );

    expect(result.items.map((item) => [item.type, item.state, item.nodeId])).toEqual([
      ["issue", "open", "I_sample_1"],
      ["pr", "merged", "PR_sample_11"],
    ]);
    expect(result.items[0]?.bodyExcerpt.length).toBeLessThanOrEqual(2000);
    expect(result.rateLimit.remaining).toBe(4997);
    expect(result.hasNextPage).toBe(false);
  });

  test("uses PR-detail rate limits and leaves a partial page resumable at the safety floor", async () => {
    const pull = JSON.parse(await readFile(resolve(fixtures, "pull.json"), "utf8"));
    let pullCalls = 0;
    const gateway: GitHubGateway = {
      async listIssuesPage() {
        return {
          items: [
            { ...pull, node_id: "PR_WRAPPER_1", number: 11, pull_request: { url: "https://api.github.com/pulls/11" } },
            { ...pull, node_id: "PR_WRAPPER_2", number: 12, pull_request: { url: "https://api.github.com/pulls/12" } },
          ],
          hasNextPage: false,
          rateLimit: { remaining: 51, resetAt: "2026-08-20T05:00:00.000Z" },
        };
      },
      async getPull() {
        pullCalls += 1;
        return {
          item: { ...pull, node_id: `PR_DETAIL_${pullCalls}`, number: 10 + pullCalls },
          rateLimit: { remaining: 49, resetAt: "2026-08-20T05:00:00.000Z" },
        };
      },
    };

    const result = await collectRepositoryPage(
      gateway,
      {
        slug: "hiyouga/LlamaFactory",
        dataKey: "llamafactory",
        historyStartAt: "1970-01-01T00:00:00.000Z",
        backfillPageLimit: 2,
        framework: "LLaMA-Factory",
        enabled: true,
        defaultBranch: "main",
        color: "#A86845",
        keywords: [],
      },
      { since: "2026-08-20T00:00:00.000Z", page: 1, sort: "created", direction: "asc" },
      "2026-08-20T05:00:00.000Z",
    );

    expect(result.items.map((item) => item.nodeId)).toEqual(["PR_DETAIL_1"]);
    expect(result.rateLimit.remaining).toBe(49);
    expect(result.pageComplete).toBe(false);
    expect(result.hasNextPage).toBe(true);
    expect(pullCalls).toBe(1);
  });

  test("uses a canonical repository slug while preserving the configured identity", async () => {
    let requestedRepository = "";
    const gateway: GitHubGateway = {
      async listIssuesPage({ owner, repo, page, sort, direction }) {
        requestedRepository = `${owner}/${repo}`;
        expect({ page, sort, direction }).toEqual({ page: 2, sort: "updated", direction: "asc" });
        return { items: [], hasNextPage: false, rateLimit: { remaining: 5000, resetAt: "2026-08-20T05:00:00.000Z" } };
      },
      async getPull() {
        throw new Error("not expected");
      },
    };

    await collectRepositoryPage(gateway, {
      slug: "volcengine/verl",
      dataKey: "verl",
      historyStartAt: "1970-01-01T00:00:00.000Z",
      backfillPageLimit: 10,
      canonicalSlug: "verl-project/verl",
      framework: "verl",
      enabled: true,
      defaultBranch: "main",
      color: "#746A9C",
      keywords: [],
    }, { since: "2026-08-20T00:00:00.000Z", page: 2, sort: "updated", direction: "asc" }, "2026-08-20T05:00:00.000Z");

    expect(requestedRepository).toBe("verl-project/verl");
  });
});
