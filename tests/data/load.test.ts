import { describe, expect, test } from "vitest";
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  loadDataSnapshot,
  resolveDataRoot,
  resolveDataPath,
} from "../../src/lib/data/load";

describe("static data loader", () => {
  test("loads and validates the bootstrap snapshot", async () => {
    const snapshot = await loadDataSnapshot();

    expect(snapshot.items).toHaveLength(4);
    expect(snapshot.reports[0]?.date).toBe("2026-08-20");
    expect(snapshot.meta.repositories).toHaveLength(4);
    expect(snapshot.meta.latestReportDate).toBe("2026-08-20");
    expect(snapshot.qualityReports).toEqual([]);
    expect(Object.values(snapshot.manifest.items).map((item) => item.shard).sort()).toEqual([
      "items/llamafactory/2026/08.json",
      "items/mindspeed-llm/2026/08.json",
      "items/verl/2026/08.json",
      "items/vllm/2026/08.json",
    ]);
    expect(snapshot.manifest.backfill["vllm-project/vllm"]).toEqual({
      status: "pending",
      nextPage: 1,
      historyStartAt: "1970-01-01T00:00:00.000Z",
    });
  });

  test("uses an explicit data root without allowing traversal", () => {
    const root = resolveDataRoot("/tmp/glm-radar-data");

    expect(root).toBe("/tmp/glm-radar-data");
    expect(() => resolveDataPath(root, "../secret.json")).toThrow(
      "outside the data root",
    );
    expect(resolveDataPath(root, "items/2026/08.json")).toBe(
      "/tmp/glm-radar-data/items/2026/08.json",
    );
  });

  test("rejects a category that is not allowed for the activity type", async () => {
    const source = resolve(import.meta.dirname, "../../fixtures/bootstrap-data");
    const root = await mkdtemp(join(tmpdir(), "glm-invalid-category-"));
    await cp(source, root, { recursive: true });
    const shardPath = join(root, "items/vllm/2026/08.json");
    const items = JSON.parse(await readFile(shardPath, "utf8"));
    const pullRequest = items.find((item: { type: string }) => item.type === "pr");
    pullRequest.summary.category = "BUG";
    await writeFile(shardPath, `${JSON.stringify(items, null, 2)}\n`);

    await expect(loadDataSnapshot(root)).rejects.toThrow(
      "Category BUG is not allowed for pr",
    );
  });
});
