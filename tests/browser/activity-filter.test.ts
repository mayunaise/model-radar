import { describe, expect, test } from "vitest";
import {
  ACTIVITY_PAGE_SIZE,
  categoryOptionsForType,
  filterSearchDocuments,
  findActivityFilterTargets,
  paginateSearchDocuments,
  parseActivityFilters,
} from "../../src/scripts/activity-filter";
import { loadProjectConfig } from "../../src/lib/config/load";
import type { SearchDocument } from "../../src/lib/domain/types";

const documents: SearchDocument[] = [
  {
    id: "vllm-pr-1",
    title: "Fix GLM inference",
    summary: "修复推理输出",
    repository: "vllm-project/vllm",
    type: "pr",
    state: "merged",
    category: "FIX",
    updatedAt: "2026-08-20T09:20:00.000Z",
    url: "https://github.com/vllm-project/vllm/pull/1",
    models: ["GLM-4"],
  },
  {
    id: "lf-issue-2",
    title: "GLM training question",
    summary: "训练配置讨论",
    repository: "hiyouga/LlamaFactory",
    type: "issue",
    state: "open",
    category: "COMPATIBILITY",
    updatedAt: "2026-08-20T08:00:00.000Z",
    url: "https://github.com/hiyouga/LlamaFactory/issues/2",
    models: ["GLM-4"],
  },
];

describe("activity filtering", () => {
  test("limits filter targets to the activity explorer and excludes the daily report", () => {
    const dailyItem = { id: "daily-item" };
    const listItem = { id: "list-item" };
    const form = { id: "filters" };
    const count = { id: "count" };
    const explorer = {
      querySelector: (selector: string) => selector === "[data-activity-filters]" ? form : count,
      querySelectorAll: () => [listItem],
    };
    const page = {
      querySelector: (selector: string) => selector === "[data-activity-explorer]" ? explorer : null,
      querySelectorAll: () => [dailyItem, listItem],
    };

    expect(findActivityFilterTargets(page as unknown as ParentNode)).toEqual({
      form,
      count,
      cards: [listItem],
    });
  });

  test("derives different category options for issues and pull requests", async () => {
    const config = await loadProjectConfig();

    expect(categoryOptionsForType(config.categories, "issue")).toEqual([
      { value: "NEW_SUPPORT", label: "支持诉求" },
      { value: "BUG", label: "Bug" },
      { value: "PERFORMANCE", label: "性能问题" },
      { value: "DOCS", label: "文档问题" },
      { value: "COMPATIBILITY", label: "兼容性" },
      { value: "OTHER", label: "其他" },
    ]);
    expect(categoryOptionsForType(config.categories, "pr")).toEqual([
      { value: "NEW_SUPPORT", label: "新增支持" },
      { value: "FIX", label: "Bug 修复" },
      { value: "PERFORMANCE", label: "性能优化" },
      { value: "DOCS", label: "文档更新" },
      { value: "COMPATIBILITY", label: "兼容性适配" },
      { value: "OTHER", label: "其他" },
    ]);
  });

  test("combines text, repository, type, state, and category filters", () => {
    expect(
      filterSearchDocuments(documents, {
        query: "推理",
        repository: "vllm-project/vllm",
        type: "pr",
        state: "merged",
        category: "FIX",
        model: "GLM-4",
      }).map((item) => item.id),
    ).toEqual(["vllm-pr-1"]);

    expect(filterSearchDocuments(documents, { model: "GLM-4.5" })).toEqual([]);
  });

  test("round-trips supported URL parameters and ignores unknown keys", () => {
    expect(
      parseActivityFilters(
        new URLSearchParams(
          "q=glm&repository=vllm-project%2Fvllm&type=pr&state=merged&category=FIX&model=GLM-4&page=3&unsafe=x",
        ),
      ),
    ).toEqual({
      query: "glm",
      repository: "vllm-project/vllm",
      type: "pr",
      state: "merged",
      category: "FIX",
      model: "GLM-4",
      page: 3,
    });
  });

  test("paginates filtered results in fixed groups of fifty and clamps invalid pages", () => {
    const manyDocuments = Array.from({ length: 121 }, (_, index) => ({
      ...documents[0],
      id: `item-${index + 1}`,
    }));

    expect(ACTIVITY_PAGE_SIZE).toBe(50);
    expect(paginateSearchDocuments(manyDocuments, 3)).toMatchObject({
      currentPage: 3,
      totalPages: 3,
      totalItems: 121,
    });
    expect(paginateSearchDocuments(manyDocuments, 3).documents).toHaveLength(21);
    expect(paginateSearchDocuments(manyDocuments, 99).currentPage).toBe(3);
    expect(parseActivityFilters(new URLSearchParams("page=0")).page).toBe(1);
    expect(parseActivityFilters(new URLSearchParams("page=not-a-number")).page).toBe(1);
  });
});
