import { describe, expect, test } from "vitest";
import { auditSample, selectStratifiedSample } from "../../scripts/quality/audit";
import type { ActivityItem } from "../../src/lib/domain/types";

const base: ActivityItem = {
  id: "base",
  nodeId: "NODE_base",
  repository: "owner/repo",
  number: 1,
  type: "issue",
  title: "GLM inference crash",
  bodyExcerpt: "GLM generation fails with an exception.",
  author: "author",
  state: "open",
  labels: ["bug"],
  url: "https://github.com/owner/repo/issues/1",
  createdAt: "2026-08-20T00:00:00.000Z",
  updatedAt: "2026-08-20T01:00:00.000Z",
  mergedAt: null,
  firstSeenAt: "2026-08-20T01:00:00.000Z",
  contentHash: "sha256:base",
  category: "BUG",
  categorySource: "rules",
  summary: null,
};

const categories = {
  schemaVersion: 1 as const,
  categories: [
    { code: "NEW_SUPPORT" as const, appliesTo: ["issue", "pr"] as const, labels: { issue: "支持诉求", pr: "新增支持" }, order: 10 },
    { code: "BUG" as const, appliesTo: ["issue"] as const, labels: { issue: "Bug" }, order: 20 },
    { code: "FIX" as const, appliesTo: ["pr"] as const, labels: { pr: "Bug 修复" }, order: 20 },
    { code: "PERFORMANCE" as const, appliesTo: ["issue", "pr"] as const, labels: { issue: "性能问题", pr: "性能优化" }, order: 30 },
    { code: "DOCS" as const, appliesTo: ["issue", "pr"] as const, labels: { issue: "文档问题", pr: "文档更新" }, order: 40 },
    { code: "COMPATIBILITY" as const, appliesTo: ["issue", "pr"] as const, labels: { issue: "兼容性", pr: "兼容性适配" }, order: 50 },
    { code: "OTHER" as const, appliesTo: ["issue", "pr"] as const, labels: { issue: "其他", pr: "其他" }, order: 60 },
  ],
};

const keywords = {
  schemaVersion: 1 as const,
  global: ["GLM", "ChatGLM"],
  includePatterns: ["chat[-_ ]?glm", "glm[-_ ]?[0-9.]*"],
  excludeTerms: ["generalized linear model"],
  scenarioTerms: { training: ["train"], inference: ["infer"], rl: ["grpo"] },
};

describe("daily data quality audit", () => {
  test("selects a reproducible random sample from every type-category stratum", () => {
    const items = [
      { ...base, id: "issue-bug-a", nodeId: "A" },
      { ...base, id: "issue-bug-b", nodeId: "B", number: 2 },
      { ...base, id: "issue-support", nodeId: "C", number: 3, title: "Support GLM", category: "NEW_SUPPORT" as const },
      { ...base, id: "pr-fix", nodeId: "D", number: 4, type: "pr" as const, category: "FIX" as const },
      { ...base, id: "pr-support", nodeId: "E", number: 5, type: "pr" as const, title: "Add GLM support", category: "NEW_SUPPORT" as const },
    ];

    const first = selectStratifiedSample(items, "2026-08-21", 1);
    const second = selectStratifiedSample([...items].reverse(), "2026-08-21", 1);

    expect(first.map((item) => item.id)).toEqual(second.map((item) => item.id));
    expect(first).toHaveLength(4);
    expect(new Set(first.map((item) => `${item.type}:${item.category}`))).toEqual(new Set([
      "issue:BUG",
      "issue:NEW_SUPPORT",
      "pr:FIX",
      "pr:NEW_SUPPORT",
    ]));
  });

  test("reports source mismatches and semantic review warnings without hiding structural failures", async () => {
    const invalid = { ...base, category: "FIX" as const, title: "Unrelated tensor change", bodyExcerpt: "No model is named.", labels: [] };
    const report = await auditSample({
      items: [invalid],
      date: "2026-08-21",
      categories,
      keywords,
      source: {
        async get() {
          return { title: "Different upstream title", state: "closed", updatedAt: base.updatedAt, url: base.url };
        },
      },
    });

    expect(report.summary).toMatchObject({ sampled: 1, structuralFailures: 1, relevanceFailures: 1, sourceMismatches: 1, reviewWarnings: 1 });
    expect(report.items[0]).toMatchObject({
      categoryValid: false,
      filterDisposition: "excluded",
      sourceMatch: false,
    });
    expect(report.items[0]?.warnings).toEqual(expect.arrayContaining([
      "category-not-allowed-for-type",
      "relevance-excluded",
      "source-mismatch:title,state",
    ]));
  });

  test("treats equivalent GitHub timestamps as equal when millisecond formatting differs", async () => {
    const report = await auditSample({
      items: [base],
      date: "2026-08-21",
      categories,
      keywords,
      source: {
        async get() {
          return { ...base, updatedAt: "2026-08-20T01:00:00Z" };
        },
      },
    });

    expect(report.items[0]?.sourceMatch).toBe(true);
    expect(report.items[0]?.sourceMismatchFields).toEqual([]);
  });

  test("flags stored rule classifications that no longer match the current rules", async () => {
    const stale = { ...base, category: "DOCS" as const, categorySource: "rules" as const };
    const report = await auditSample({ items: [stale], date: "2026-08-21", categories, keywords });

    expect(report.summary.classificationDrifts).toBe(1);
    expect(report.items[0]).toMatchObject({ category: "DOCS", ruleCategory: "BUG", classificationConsistent: false });
    expect(report.items[0]?.warnings).toContain("classification-drift:DOCS->BUG");
  });

  test("audits every daily incremental item with bounded concurrent source checks", async () => {
    const items = Array.from({ length: 6 }, (_, index) => ({
      ...base,
      id: `daily-${index + 1}`,
      nodeId: `DAILY_${index + 1}`,
      number: index + 1,
    }));
    let active = 0;
    let maximumActive = 0;
    const report = await auditSample({
      items,
      date: "2026-08-21",
      categories,
      keywords,
      samplePerStratum: 1,
      auditAll: true,
      source: {
        async get(item) {
          active += 1;
          maximumActive = Math.max(maximumActive, active);
          await new Promise((resolveDelay) => setTimeout(resolveDelay, 5));
          active -= 1;
          return { title: item.title, state: item.state, updatedAt: item.updatedAt, url: item.url };
        },
      },
    });

    expect(report.scope).toBe("daily-incremental");
    expect(report.summary).toMatchObject({ population: 6, sampled: 6, relevanceFailures: 0, sourceMismatches: 0 });
    expect(report.items).toHaveLength(6);
    expect(maximumActive).toBe(4);
  });
});
