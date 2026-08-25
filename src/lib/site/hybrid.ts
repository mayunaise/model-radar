import type { ActivityItem } from "../domain/types";
import { itemPath } from "./routes";

export const HYBRID_PRERENDER_DAYS = 30;

export function hybridCutoffDate(anchorDate: string, days = HYBRID_PRERENDER_DAYS): string {
  const anchor = new Date(`${anchorDate}T00:00:00.000Z`);
  anchor.setUTCDate(anchor.getUTCDate() - (days - 1));
  return anchor.toISOString().slice(0, 10);
}

function beijingDate(timestamp: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(timestamp));
}

export function isRecentlyUpdated(item: ActivityItem, anchorDate: string): boolean {
  return beijingDate(item.updatedAt) >= hybridCutoffDate(anchorDate);
}

export function isRecentReport(date: string, anchorDate: string): boolean {
  return date >= hybridCutoffDate(anchorDate);
}

export function hybridItemPath(item: ActivityItem, anchorDate: string): string {
  return isRecentlyUpdated(item, anchorDate)
    ? itemPath(item.repository, item.type, item.number)
    : `/activity/detail/?id=${encodeURIComponent(item.id)}`;
}

export function hybridReportPath(date: string, anchorDate: string): string {
  return isRecentReport(date, anchorDate)
    ? `/reports/${date}/`
    : `/reports/detail/?date=${encodeURIComponent(date)}`;
}
