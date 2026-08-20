import { describe, expect, test } from "vitest";
import { buildSearchIndex } from "../../scripts/build-search-index";
import type { ActivityItem } from "../../src/lib/domain/types";

describe("search index generation", () => {
  test("emits only compact public fields in newest-first order", () => {
    const item = {
      id: "a",
      title: "GLM fix",
      summary: { headlineZh: "修复", summaryZh: "修复摘要", category: "FIX", models: ["GLM"] },
      repository: "owner/repo",
      type: "pr",
      state: "merged",
      updatedAt: "2026-08-20T01:00:00.000Z",
      url: "https://github.com/owner/repo/pull/1",
      bodyExcerpt: "must not leak into index",
    } as ActivityItem;

    expect(buildSearchIndex([item])).toEqual([
      {
        id: "a",
        title: "GLM fix",
        summary: "修复摘要",
        repository: "owner/repo",
        type: "pr",
        state: "merged",
        category: "FIX",
        updatedAt: "2026-08-20T01:00:00.000Z",
        url: "https://github.com/owner/repo/pull/1",
        models: ["GLM"],
      },
    ]);
  });
});
