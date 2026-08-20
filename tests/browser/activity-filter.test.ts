import { describe, expect, test } from "vitest";
import {
  filterSearchDocuments,
  parseActivityFilters,
} from "../../src/scripts/activity-filter";
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
  test("combines text, repository, type, state, and category filters", () => {
    expect(
      filterSearchDocuments(documents, {
        query: "推理",
        repository: "vllm-project/vllm",
        type: "pr",
        state: "merged",
        category: "FIX",
      }).map((item) => item.id),
    ).toEqual(["vllm-pr-1"]);
  });

  test("round-trips supported URL parameters and ignores unknown keys", () => {
    expect(
      parseActivityFilters(
        new URLSearchParams(
          "q=glm&repository=vllm-project%2Fvllm&type=pr&state=merged&category=FIX&unsafe=x",
        ),
      ),
    ).toEqual({
      query: "glm",
      repository: "vllm-project/vllm",
      type: "pr",
      state: "merged",
      category: "FIX",
    });
  });
});
