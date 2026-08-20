import { describe, expect, test } from "vitest";
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
});
