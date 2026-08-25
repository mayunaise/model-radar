import { loadProjectConfig } from "../config/load";
import type { ActivityItem, CapabilityEntry, DailyReport, RepositoryConfig, Summary } from "../domain/types";
import { categoryForItem } from "../domain/classification";
import { loadDataSnapshot } from "./load";

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
    if (filters.category && categoryForItem(item) !== filters.category) return false;
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

type PublicDataSource = {
  items: ActivityItem[];
  reports: DailyReport[];
  capabilities: CapabilityEntry[];
};

function reportCompleteness(items: ActivityItem[]): DailyReport["completeness"] {
  const summarized = items.filter((item) => item.summary).length;
  if (summarized === items.length) return "complete";
  if (summarized === 0) return "github-only";
  return "partial";
}

export function createPublicDataView(
  source: PublicDataSource,
  repositories: RepositoryConfig["repositories"],
) {
  const enabledRepositories = repositories.filter((repository) => repository.enabled);
  const enabledSlugs = new Set(enabledRepositories.map((repository) => repository.slug));
  const enabledFrameworks = new Set(enabledRepositories.map((repository) => repository.framework));
  const items = source.items.filter((item) => enabledSlugs.has(item.repository));
  const itemsById = new Map(items.map((item) => [item.id, item]));
  const reports = source.reports.map((report) => {
    const groups = report.groups.map((group) => ({
      ...group,
      itemIds: group.itemIds.filter((id) => itemsById.has(id)),
    }));
    const changed = groups.some((group, index) => group.itemIds.length !== report.groups[index]?.itemIds.length);
    if (!changed) return report;
    const reportItems = [...new Set(groups.flatMap((group) => group.itemIds))]
      .flatMap((id) => {
        const item = itemsById.get(id);
        return item ? [item] : [];
      });
    const issueCount = reportItems.filter((item) => item.type === "issue").length;
    const prCount = reportItems.length - issueCount;
    return {
      ...report,
      groups,
      intro: reportItems.length
        ? `今日新增或更新 ${reportItems.length} 条 GLM 相关动态：${issueCount} 个 Issue，${prCount} 个 PR。`
        : "今日暂无新增或更新的 GLM 相关动态。",
      completeness: reportCompleteness(reportItems),
    };
  });

  return {
    repositories: enabledRepositories,
    items,
    reports,
    capabilities: source.capabilities.filter((entry) => enabledFrameworks.has(entry.framework)),
  };
}

export async function loadPublicDataSnapshot(explicitRoot?: string) {
  const [snapshot, config] = await Promise.all([
    loadDataSnapshot(explicitRoot),
    loadProjectConfig(),
  ]);
  return {
    ...snapshot,
    ...createPublicDataView(snapshot, config.repositories.repositories),
    categories: config.categories,
  };
}
