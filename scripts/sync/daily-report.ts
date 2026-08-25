import type { ActivityItem, DailyReport, DataEvent } from "../../src/lib/domain/types";

const attentionRank = { IMMEDIATE: 0, WATCH: 1, ROUTINE: 2 } as const;
const severityRank = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, INFO: 4 } as const;

export function hasMeaningfulChange(previous: ActivityItem | undefined, next: ActivityItem): boolean {
  return !previous || previous.contentHash !== next.contentHash;
}

export function sortDailyItems(items: ActivityItem[]): ActivityItem[] {
  return [...items].sort((left, right) => {
    const leftAttention = left.summary ? attentionRank[left.summary.attention] : 3;
    const rightAttention = right.summary ? attentionRank[right.summary.attention] : 3;
    if (leftAttention !== rightAttention) return leftAttention - rightAttention;

    const leftSeverity = left.summary ? severityRank[left.summary.severity] : 5;
    const rightSeverity = right.summary ? severityRank[right.summary.severity] : 5;
    return leftSeverity - rightSeverity
      || right.updatedAt.localeCompare(left.updatedAt)
      || left.id.localeCompare(right.id);
  });
}

function completeness(items: ActivityItem[]): DailyReport["completeness"] {
  const summarized = items.filter((item) => item.summary).length;
  if (summarized === items.length) return "complete";
  if (summarized === 0) return "github-only";
  return "partial";
}

export function mergeDailyReport(
  date: string,
  existing: DailyReport | undefined,
  delta: ActivityItem[],
  allItems: ActivityItem[],
  now: string,
): DailyReport {
  const ids = new Set(existing?.groups.flatMap((group) => group.itemIds) ?? []);
  delta.forEach((item) => ids.add(item.id));
  const itemsById = new Map(allItems.map((item) => [item.id, item]));
  const items = sortDailyItems([...ids].flatMap((id) => {
    const item = itemsById.get(id);
    return item ? [item] : [];
  }));
  const issueCount = items.filter((item) => item.type === "issue").length;
  const prCount = items.length - issueCount;

  return {
    date,
    intro: items.length
      ? `今日新增或更新 ${items.length} 条 GLM 相关动态：${issueCount} 个 Issue，${prCount} 个 PR。`
      : "今日暂无新增或更新的 GLM 相关动态。",
    groups: [{ key: "daily", title: "今日动态", itemIds: items.map((item) => item.id) }],
    completeness: completeness(items),
    model: "gpt-5.6-luna",
    promptVersion: "deterministic-daily-v2",
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}

function beijingDate(timestamp: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(timestamp));
}

export function backfillMissingDailyReports(
  existing: DailyReport[],
  items: ActivityItem[],
  events: DataEvent[],
  now: string,
): DailyReport[] {
  const existingDates = new Set(existing.map((report) => report.date));
  const itemsByDate = new Map<string, ActivityItem[]>();
  for (const item of items) {
    const date = beijingDate(item.createdAt);
    itemsByDate.set(date, [...(itemsByDate.get(date) ?? []), item]);
  }
  const itemsById = new Map(items.map((item) => [item.id, item]));
  for (const event of events) {
    const item = itemsById.get(event.itemId);
    if (!item) continue;
    const date = beijingDate(event.occurredAt);
    itemsByDate.set(date, [...(itemsByDate.get(date) ?? []), item]);
  }
  return [...itemsByDate.entries()]
    .filter(([date]) => !existingDates.has(date))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, dateItems]) => mergeDailyReport(date, undefined, dateItems, items, now));
}

export function refreshDailyReports(
  reports: DailyReport[],
  items: ActivityItem[],
  now: string,
): DailyReport[] {
  const itemsById = new Map(items.map((item) => [item.id, item]));
  return reports.map((report) => {
    const reportItems = report.groups.flatMap((group) => group.itemIds)
      .flatMap((id) => {
        const item = itemsById.get(id);
        return item ? [item] : [];
      });
    return mergeDailyReport(report.date, report, [], reportItems, now);
  });
}

// A source backfill can discover an item after a report for its creation date
// already exists. Reconcile those creation-day items into every historical
// report; otherwise only entirely missing dates are backfilled.
export function reconcileHistoricalDailyReports(
  reports: DailyReport[],
  items: ActivityItem[],
  events: DataEvent[],
  now: string,
): DailyReport[] {
  const itemsByCreatedDate = new Map<string, ActivityItem[]>();
  for (const item of items) {
    const date = beijingDate(item.createdAt);
    itemsByCreatedDate.set(date, [...(itemsByCreatedDate.get(date) ?? []), item]);
  }

  const itemsById = new Map(items.map((item) => [item.id, item]));
  const itemsByEventDate = new Map<string, ActivityItem[]>();
  for (const event of events) {
    const item = itemsById.get(event.itemId);
    if (!item) continue;
    const date = beijingDate(event.occurredAt);
    itemsByEventDate.set(date, [...(itemsByEventDate.get(date) ?? []), item]);
  }

  return reports.map((report) => mergeDailyReport(
    report.date,
    report,
    [
      ...(itemsByCreatedDate.get(report.date) ?? []),
      ...(itemsByEventDate.get(report.date) ?? []),
    ],
    items,
    now,
  ));
}
