import { beforeAll, describe, expect, test } from "vitest";
import { loadProjectConfig } from "../../src/lib/config/load";
import { loadDataSnapshot } from "../../src/lib/data/load";
import {
  createPublicDataView,
  filterItems,
  findReport,
  sortItemsNewestFirst,
} from "../../src/lib/data/query";
import type { ActivityItem } from "../../src/lib/domain/types";

let items: ActivityItem[];

beforeAll(async () => {
  items = (await loadDataSnapshot()).items;
});

describe("static data queries", () => {
  test("sorts newest first with stable ID ordering", () => {
    const sorted = sortItemsNewestFirst([
      { ...items[0], id: "b", updatedAt: "2026-08-20T10:00:00.000Z" },
      { ...items[1], id: "a", updatedAt: "2026-08-20T10:00:00.000Z" },
    ]);

    expect(sorted.map((item) => item.id)).toEqual(["a", "b"]);
  });

  test("filters by repository, type, state, category, and text", () => {
    expect(
      filterItems(items, {
        repository: "vllm-project/vllm",
        type: "pr",
        state: "merged",
        category: "FIX",
        query: "推理",
      }).map((item) => item.repository),
    ).toEqual(["vllm-project/vllm"]);
  });

  test("finds a report by its Beijing calendar date", async () => {
    const reports = (await loadDataSnapshot()).reports;

    expect(findReport(reports, "2026-08-20")?.date).toBe("2026-08-20");
    expect(findReport(reports, "2026-08-19")).toBeUndefined();
  });

  test("builds a public view that hides disabled frameworks without deleting source data", async () => {
    const snapshot = await loadDataSnapshot();
    const config = await loadProjectConfig();
    const repositories = config.repositories.repositories.map((repository) => (
      repository.slug === "vllm-project/vllm" ? { ...repository, enabled: false } : repository
    ));
    const view = createPublicDataView(snapshot, repositories);

    expect(snapshot.items.some((item) => item.repository === "vllm-project/vllm")).toBe(true);
    expect(view.repositories.some((repository) => repository.slug === "vllm-project/vllm")).toBe(false);
    expect(view.items.some((item) => item.repository === "vllm-project/vllm")).toBe(false);
    expect(view.capabilities.some((entry) => entry.framework === "vLLM")).toBe(false);
    expect(view.reports.flatMap((report) => report.groups.flatMap((group) => group.itemIds))).not.toContain("vllm-pr-10004");
    expect(view.reports[0]?.intro).toContain("3 条");
  });
});
