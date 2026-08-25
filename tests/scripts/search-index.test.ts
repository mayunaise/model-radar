import { describe, expect, test } from "vitest";
import { buildSearchIndex } from "../../scripts/build-search-index";
import type { ActivityItem } from "../../src/lib/domain/types";

const baseItem: ActivityItem = {
  id: "base",
  nodeId: "NODE_base",
  repository: "owner/repo",
  number: 1,
  type: "issue",
  title: "GLM activity",
  bodyExcerpt: "",
  author: "author",
  state: "open",
  labels: [],
  url: "https://github.com/owner/repo/issues/1",
  createdAt: "2026-08-20T00:00:00.000Z",
  updatedAt: "2026-08-20T01:00:00.000Z",
  mergedAt: null,
  firstSeenAt: "2026-08-20T01:00:00.000Z",
  contentHash: "sha256:base",
  summary: null,
};

describe("search index generation", () => {
  test("emits only compact public fields in newest-first order", () => {
    const item: ActivityItem = {
      ...baseItem,
      id: "a",
      title: "GLM fix",
      summary: {
        headlineZh: "修复",
        summaryZh: "修复摘要",
        models: ["GLM"],
        hardware: ["GPU"],
        scenarios: ["INFERENCE"],
        category: "FIX",
        severity: "LOW",
        impactScopeZh: "推理",
        attention: "ROUTINE",
        capabilityCandidate: false,
        evidence: [],
        truncated: false,
        model: "gpt-5.6-luna",
        promptVersion: "test-v1",
        generatedAt: "2026-08-20T01:00:00.000Z",
      },
      type: "pr",
      state: "merged",
      url: "https://github.com/owner/repo/pull/1",
      bodyExcerpt: "must not leak into index",
    };

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
        models: ["GLM（未指定版本）"],
      },
    ]);
  });

  test("derives canonical model names without an AI summary", () => {
    const item: ActivityItem = {
      ...baseItem,
      id: "b",
      title: "GLM 4.7 Flash and GLM-4.5-Air compatibility",
      url: "https://github.com/owner/repo/issues/2",
      bodyExcerpt: "Also reproduces on GLM 4.6v; GLM-5.2-MXFP4 is unaffected.",
      labels: ["model"],
    };

    expect(buildSearchIndex([item])[0]?.models).toEqual([
      "GLM-5.2",
      "GLM-4.7",
      "GLM-4.6",
      "GLM-4.5",
    ]);
  });

  test("uses an explicit fallback for broad GLM references", () => {
    const item: ActivityItem = {
      ...baseItem,
      id: "c",
      title: "General GLM support question",
      url: "https://github.com/owner/repo/issues/3",
      bodyExcerpt: "No exact model version is specified.",
    };

    expect(buildSearchIndex([item])[0]?.models).toEqual(["GLM（未指定版本）"]);
  });

  test("indexes a local category when an AI summary is unavailable", () => {
    const item: ActivityItem = {
      ...baseItem,
      title: "GLM inference crashes with an invalid tensor shape",
      bodyExcerpt: "The request fails with an exception.",
      labels: ["bug"],
    };

    expect(buildSearchIndex([item])[0]?.category).toBe("BUG");
  });

  test("does not classify parser names, channels, or quantization as model versions", () => {
    const item: ActivityItem = {
      ...baseItem,
      id: "d",
      title: "GLM-5.1 tool calling regression",
      bodyExcerpt: "Use --tool-call-parser glm47 and --reasoning-parser glm45; discuss in #sprint-glm52. The checkpoint is GLM-5.1-FP8.",
    };

    expect(buildSearchIndex([item])[0]?.models).toEqual(["GLM-5.1"]);
  });

  test("groups model variants and patch releases under their major family", () => {
    const item: ActivityItem = {
      ...baseItem,
      id: "e",
      title: "Add GLM-OCR and GLM-4-0414 support",
      bodyExcerpt: "Also validate GLM-5.2-Vision-NVFP4 through plugins/glm5v/processor.py.",
    };

    expect(buildSearchIndex([item])[0]?.models).toEqual([
      "GLM-5.2",
      "GLM-4",
      "GLM-OCR",
    ]);
  });

  test("automatically recognizes future GLM major families", () => {
    const item: ActivityItem = {
      ...baseItem,
      id: "f",
      title: "Enable GLM-5.3-FP8 inference",
      bodyExcerpt: "Compatible with GLM-5.3.1 checkpoints.",
    };

    expect(buildSearchIndex([item])[0]?.models).toEqual(["GLM-5.3"]);
  });
});
