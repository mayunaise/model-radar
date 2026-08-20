import type { ActivityItem, DailyReport, Summary } from "../domain/types";

type ItemFilters = {
  repository?: string;
  type?: ActivityItem["type"];
  state?: ActivityItem["state"];
  category?: Summary["category"];
  query?: string;
};

export function sortItemsNewestFirst(items: ActivityItem[]): ActivityItem[] {
  return [...items].sort(
    (left, right) =>
      right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id),
  );
}

export function filterItems(items: ActivityItem[], filters: ItemFilters): ActivityItem[] {
  const query = filters.query?.trim().toLocaleLowerCase();
  return sortItemsNewestFirst(items).filter((item) => {
    if (filters.repository && item.repository !== filters.repository) return false;
    if (filters.type && item.type !== filters.type) return false;
    if (filters.state && item.state !== filters.state) return false;
    if (filters.category && item.summary?.category !== filters.category) return false;
    if (query) {
      const searchable = [
        item.title,
        item.summary?.headlineZh,
        item.summary?.summaryZh,
        item.repository,
        ...item.labels,
      ]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase();
      if (!searchable.includes(query)) return false;
    }
    return true;
  });
}

export function findReport(reports: DailyReport[], date: string): DailyReport | undefined {
  return reports.find((report) => report.date === date);
}
