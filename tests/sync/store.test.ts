import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { itemShard, mergeItems, writeJsonAtomic } from "../../scripts/sync/store";
import type { ActivityItem } from "../../src/lib/domain/types";

const item = { id: "a", nodeId: "N1", updatedAt: "2026-08-20T00:00:00.000Z" } as ActivityItem;

describe("static shard store", () => {
  test("atomically writes stable formatted JSON", async () => {
    const root = await mkdtemp(join(tmpdir(), "glm-store-"));
    await writeJsonAtomic(root, "items/2026/08.json", [item]);

    expect(await readFile(join(root, "items/2026/08.json"), "utf8")).toBe(
      `${JSON.stringify([item], null, 2)}\n`,
    );
  });

  test("deduplicates by node ID and keeps the newest update", () => {
    const newer = { ...item, id: "new", updatedAt: "2026-08-20T01:00:00.000Z" };
    expect(mergeItems([item], [newer])).toEqual([newer]);
  });

  test("shards items by repository and upstream creation month", () => {
    const repositories = [{
      slug: "vllm-project/vllm",
      dataKey: "vllm",
    }] as never;
    const created = {
      ...item,
      repository: "vllm-project/vllm",
      createdAt: "2024-11-19T00:00:00.000Z",
      firstSeenAt: "2026-08-20T00:00:00.000Z",
    } as ActivityItem;

    expect(itemShard(created, repositories)).toBe("items/vllm/2024/11.json");
  });
});
