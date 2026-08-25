import { describe, expect, test } from "vitest";
import { hybridCutoffDate, hybridItemPath, hybridReportPath, isRecentReport, isRecentlyUpdated } from "../../src/lib/site/hybrid";
import type { ActivityItem } from "../../src/lib/domain/types";

function item(updatedAt: string): ActivityItem {
  return {
    id: "vllm-issue-1",
    nodeId: "NODE_1",
    repository: "vllm-project/vllm",
    number: 1,
    type: "issue",
    title: "GLM issue",
    bodyExcerpt: "",
    author: "tester",
    state: "open",
    labels: [],
    url: "https://github.com/vllm-project/vllm/issues/1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt,
    firstSeenAt: updatedAt,
    contentHash: "sha256:one",
    summary: null,
  };
}

describe("hybrid static routes", () => {
  test("uses an inclusive rolling 30-day window", () => {
    expect(hybridCutoffDate("2026-08-24")).toBe("2026-07-26");
    expect(isRecentReport("2026-07-26", "2026-08-24")).toBe(true);
    expect(isRecentReport("2026-07-25", "2026-08-24")).toBe(false);
  });

  test("pre-renders recently updated items and sends older items to the data shell", () => {
    const recent = item("2026-07-25T16:00:00.000Z");
    const historical = item("2026-07-25T15:59:59.000Z");

    expect(isRecentlyUpdated(recent, "2026-08-24")).toBe(true);
    expect(hybridItemPath(recent, "2026-08-24")).toBe("/activity/vllm-project-vllm/issue/1/");
    expect(isRecentlyUpdated(historical, "2026-08-24")).toBe(false);
    expect(hybridItemPath(historical, "2026-08-24")).toBe("/activity/detail/?id=vllm-issue-1");
  });

  test("uses the historical report shell outside the rolling window", () => {
    expect(hybridReportPath("2026-07-26", "2026-08-24")).toBe("/reports/2026-07-26/");
    expect(hybridReportPath("2026-07-25", "2026-08-24")).toBe("/reports/detail/?date=2026-07-25");
  });
});
