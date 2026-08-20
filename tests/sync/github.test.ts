import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { collectRepository } from "../../scripts/sync/github";
import type { GitHubGateway } from "../../scripts/sync/types";

const fixtures = resolve(import.meta.dirname, "../fixtures/github");

describe("GitHub collection boundary", () => {
  test("normalizes issues and expands PR wrappers exactly once", async () => {
    const issues = JSON.parse(await readFile(resolve(fixtures, "issues.json"), "utf8"));
    const pull = JSON.parse(await readFile(resolve(fixtures, "pull.json"), "utf8"));
    const gateway: GitHubGateway = {
      async listIssues() {
        return {
          items: issues,
          rateLimit: { remaining: 4998, resetAt: "2026-08-20T05:00:00.000Z" },
        };
      },
      async getPull() {
        return pull;
      },
    };

    const result = await collectRepository(
      gateway,
      {
        slug: "hiyouga/LlamaFactory",
        framework: "LLaMA-Factory",
        enabled: true,
        defaultBranch: "main",
        color: "#A86845",
        keywords: [],
      },
      "2026-08-20T00:00:00.000Z",
      "2026-08-20T05:00:00.000Z",
    );

    expect(result.items.map((item) => [item.type, item.state, item.nodeId])).toEqual([
      ["issue", "open", "I_sample_1"],
      ["pr", "merged", "PR_sample_11"],
    ]);
    expect(result.items[0]?.bodyExcerpt.length).toBeLessThanOrEqual(2000);
    expect(result.rateLimit.remaining).toBe(4998);
  });

  test("uses a canonical repository slug while preserving the configured identity", async () => {
    let requestedRepository = "";
    const gateway: GitHubGateway = {
      async listIssues({ owner, repo }) {
        requestedRepository = `${owner}/${repo}`;
        return { items: [], rateLimit: { remaining: 5000, resetAt: "2026-08-20T05:00:00.000Z" } };
      },
      async getPull() {
        throw new Error("not expected");
      },
    };

    await collectRepository(gateway, {
      slug: "volcengine/verl",
      canonicalSlug: "verl-project/verl",
      framework: "verl",
      enabled: true,
      defaultBranch: "main",
      color: "#746A9C",
      keywords: [],
    }, "2026-08-20T00:00:00.000Z", "2026-08-20T05:00:00.000Z");

    expect(requestedRepository).toBe("verl-project/verl");
  });
});
