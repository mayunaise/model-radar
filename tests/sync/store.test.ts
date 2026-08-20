import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { mergeItems, writeJsonAtomic } from "../../scripts/sync/store";
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
});
