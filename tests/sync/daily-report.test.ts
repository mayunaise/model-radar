import { describe, expect, test } from "vitest";
import { backfillMissingDailyReports, hasMeaningfulChange, mergeDailyReport, reconcileHistoricalDailyReports, refreshDailyReports, sortDailyItems } from "../../scripts/sync/daily-report";
import type { ActivityItem, DailyReport } from "../../src/lib/domain/types";

function item(overrides: Partial<ActivityItem>): ActivityItem {
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
    createdAt: "2026-08-20T01:00:00.000Z",
    updatedAt: "2026-08-20T02:00:00.000Z",
    firstSeenAt: "2026-08-20T03:00:00.000Z",
    contentHash: "sha256:one",
    summary: null,
    ...overrides,
  };
}

describe("daily incremental report", () => {
  test("only treats new or content-changed records as meaningful", () => {
    const previous = item({ contentHash: "sha256:old" });
    expect(hasMeaningfulChange(undefined, previous)).toBe(true);
    expect(hasMeaningfulChange(previous, { ...previous })).toBe(false);
    expect(hasMeaningfulChange(previous, { ...previous, contentHash: "sha256:new" })).toBe(true);
  });

  test("sorts by attention, severity, newest update, then stable id", () => {
    const routine = item({ id: "routine", nodeId: "R", updatedAt: "2026-08-20T05:00:00.000Z" });
    const watch = item({
      id: "watch",
      nodeId: "W",
      summary: { attention: "WATCH", severity: "LOW" } as ActivityItem["summary"],
    });
    const immediate = item({
      id: "immediate",
      nodeId: "I",
      summary: { attention: "IMMEDIATE", severity: "HIGH" } as ActivityItem["summary"],
    });

    expect(sortDailyItems([routine, watch, immediate]).map((entry) => entry.id)).toEqual([
      "immediate",
      "watch",
      "routine",
    ]);
  });

  test("unions repeated same-day deltas and keeps only compact item references", () => {
    const issue = item({ id: "issue", nodeId: "ISSUE", type: "issue" });
    const pr = item({ id: "pr", nodeId: "PR", type: "pr", number: 2, state: "merged" });
    const existing: DailyReport = {
      date: "2026-08-20",
      intro: "old",
      groups: [{ key: "daily", title: "今日动态", itemIds: [issue.id] }],
      completeness: "github-only",
      model: "gpt-5.6-luna",
      promptVersion: "deterministic-daily-v2",
      createdAt: "2026-08-20T03:00:00.000Z",
      updatedAt: "2026-08-20T03:00:00.000Z",
    };

    const report = mergeDailyReport("2026-08-20", existing, [pr], [issue, pr], "2026-08-20T04:00:00.000Z");

    expect(report.intro).toBe("今日新增或更新 2 条 GLM 相关动态：1 个 Issue，1 个 PR。");
    expect(report.groups).toEqual([{ key: "daily", title: "今日动态", itemIds: ["issue", "pr"] }]);
    expect(report.createdAt).toBe(existing.createdAt);
    expect(report.updatedAt).toBe("2026-08-20T04:00:00.000Z");
  });

  test("creates an explicit empty report when the day has no incremental changes", () => {
    const report = mergeDailyReport("2026-08-21", undefined, [], [], "2026-08-21T01:00:00.000Z");

    expect(report.intro).toBe("今日暂无新增或更新的 GLM 相关动态。");
    expect(report.groups).toEqual([{ key: "daily", title: "今日动态", itemIds: [] }]);
    expect(report.completeness).toBe("complete");
  });

  test("backfills only missing creation-day reports and preserves existing dates", () => {
    const existing = mergeDailyReport("2026-08-20", undefined, [], [], "2026-08-24T00:00:00.000Z");
    const first = item({ id: "first", nodeId: "FIRST", createdAt: "2026-08-20T17:00:00.000Z" });
    const second = item({ id: "second", nodeId: "SECOND", number: 2, createdAt: "2026-08-22T04:00:00.000Z" });

    const reports = backfillMissingDailyReports([existing], [first, second], [], "2026-08-24T00:00:00.000Z");

    expect(reports.map((report) => report.date)).toEqual(["2026-08-21", "2026-08-22"]);
    expect(reports.map((report) => report.groups[0]?.itemIds)).toEqual([["first"], ["second"]]);
  });

  test("backfills a missing report date that contains only a state event", () => {
    const changed = item({ updatedAt: "2026-08-22T04:00:00.000Z" });
    const reports = backfillMissingDailyReports([], [changed], [{
      id: "NODE_1-state-closed",
      itemId: changed.id,
      type: "state",
      oldValue: "open",
      newValue: "closed",
      occurredAt: "2026-08-22T04:00:00.000Z",
    }], "2026-08-24T00:00:00.000Z");

    expect(reports.map((report) => report.date)).toEqual(["2026-08-20", "2026-08-22"]);
    expect(reports[1]?.groups[0]?.itemIds).toEqual([changed.id]);
  });

  test("refreshes stale report completeness without changing membership or creation time", () => {
    const summarized = item({
      summary: { attention: "WATCH", severity: "MEDIUM" } as ActivityItem["summary"],
    });
    const stale = {
      ...mergeDailyReport("2026-08-20", undefined, [item({})], [item({})], "2026-08-20T03:00:00.000Z"),
      completeness: "github-only" as const,
    };

    const [refreshed] = refreshDailyReports([stale], [summarized], "2026-08-24T00:00:00.000Z");

    expect(refreshed?.completeness).toBe("complete");
    expect(refreshed?.groups[0]?.itemIds).toEqual([summarized.id]);
    expect(refreshed?.createdAt).toBe(stale.createdAt);
  });

  test("reconciles late-backfilled items into an already existing creation-day report", () => {
    const existingItem = item({ id: "existing", nodeId: "EXISTING" });
    const lateBackfill = item({
      id: "late-backfill",
      nodeId: "LATE_BACKFILL",
      number: 2,
      type: "pr",
      createdAt: "2026-08-20T16:30:00.000Z",
    });
    const report = mergeDailyReport(
      "2026-08-21",
      undefined,
      [existingItem],
      [existingItem],
      "2026-08-21T03:00:00.000Z",
    );

    const [reconciled] = reconcileHistoricalDailyReports(
      [report],
      [existingItem, lateBackfill],
      [],
      "2026-08-24T00:00:00.000Z",
    );

    expect(reconciled?.groups[0]?.itemIds).toEqual(["existing", "late-backfill"]);
    expect(reconciled?.intro).toBe("今日新增或更新 2 条 GLM 相关动态：1 个 Issue，1 个 PR。");
    expect(reconciled?.createdAt).toBe(report.createdAt);
  });

  test("reconciles a late-backfilled state event into its event-day report", () => {
    const changed = item({
      id: "mindspeed-pr",
      nodeId: "MINDSPEED_PR",
      repository: "Ascend/MindSpeed-LLM",
      type: "pr",
      state: "merged",
      createdAt: "2026-08-18T09:18:21.000Z",
      updatedAt: "2026-08-24T07:10:38.000Z",
    });
    const report = mergeDailyReport("2026-08-24", undefined, [], [], "2026-08-24T08:00:00.000Z");

    const [reconciled] = reconcileHistoricalDailyReports(
      [report],
      [changed],
      [{
        id: "MINDSPEED_PR-state-merged",
        itemId: changed.id,
        type: "state",
        oldValue: "open",
        newValue: "merged",
        occurredAt: "2026-08-24T07:10:38.000Z",
      }],
      "2026-08-24T12:00:00.000Z",
    );

    expect(reconciled?.groups[0]?.itemIds).toEqual([changed.id]);
  });
});
