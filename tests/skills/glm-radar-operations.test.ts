import { execFile } from "node:child_process";
import { access, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, test } from "vitest";
import { loadDataSnapshot } from "../../src/lib/data/load";
import { initializeProductionData } from "../../.agents/skills/glm-radar-operations/scripts/initialize-production-data";

const execFileAsync = promisify(execFile);
const projectRoot = resolve(import.meta.dirname, "../..");

describe("GLM Radar operations skill", () => {
  test("documents the daily full-increment quality audit and its failure policy", async () => {
    const reference = await readFile(join(projectRoot, ".agents/skills/glm-radar-operations/references/operations.md"), "utf8");

    expect(reference).toContain("npm run audit:data -- ../data");
    expect(reference).toContain("当天日报中的全部增量");
    expect(reference).toContain("结构错误或相关性排除会阻止发布");
    expect(reference).toContain("分类和源数据差异产生复核警告");
  });
  test("initializes a clean production data snapshot without sample records", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "glm-production-data-"));

    await initializeProductionData({
      projectRoot: resolve(import.meta.dirname, "../.."),
      outputDir,
      now: "2026-08-20T12:00:00.000Z",
    });

    const snapshot = await loadDataSnapshot(outputDir);
    expect(snapshot.items).toEqual([]);
    expect(snapshot.reports).toEqual([]);
    expect(snapshot.events).toEqual([]);
    expect(snapshot.meta.sample).toBe(false);
    expect(snapshot.meta.repositories).toHaveLength(4);
    expect(snapshot.meta.repositories.every((repository) => repository.status === "degraded")).toBe(true);
    expect(snapshot.meta.ai).toMatchObject({
      budgetDate: "2026-08-20",
      estimatedCostUsd: 0,
      itemsSummarized: 0,
      inputTokens: 0,
      outputTokens: 0,
    });
    expect(snapshot.manifest.items).toEqual({});
    expect(snapshot.manifest.cursors).toEqual({});
    expect(snapshot.manifest.backfill["vllm-project/vllm"]).toEqual({
      status: "pending",
      nextPage: 1,
      historyStartAt: "1970-01-01T00:00:00.000Z",
    });
    expect(snapshot.manifest.searchBackfill["vllm-project/vllm"]).toEqual({
      status: "pending",
      type: "issue",
      nextPage: 1,
      queryVersion: "glm-title-v1",
    });
    await expect(access(join(outputDir, "items/.gitkeep"))).resolves.toBeUndefined();
    await expect(access(join(outputDir, "reports/.gitkeep"))).resolves.toBeUndefined();
    await expect(access(join(outputDir, "events/.gitkeep"))).resolves.toBeUndefined();
  });

  test("refuses to overwrite a non-empty data directory", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "glm-existing-data-"));
    await writeFile(join(outputDir, "keep.txt"), "owned by maintainer\n", "utf8");

    await expect(initializeProductionData({
      projectRoot: resolve(import.meta.dirname, "../.."),
      outputDir,
      now: "2026-08-20T12:00:00.000Z",
    })).rejects.toThrow("Output directory must be empty");
  });

  test("provides a CLI for initializing a separate data worktree", async () => {
    const parent = await mkdtemp(join(tmpdir(), "glm-production-cli-"));
    const outputDir = join(parent, "data");
    const script = join(projectRoot, ".agents/skills/glm-radar-operations/scripts/initialize-production-data.ts");

    const result = await execFileAsync(process.execPath, [
      "--import",
      "tsx",
      script,
      "--output",
      outputDir,
      "--now",
      "2026-08-20T12:00:00.000Z",
    ], { cwd: projectRoot });

    expect(result.stdout).toContain("Initialized clean production data");
    const snapshot = await loadDataSnapshot(outputDir);
    expect(snapshot.items).toEqual([]);
    expect(snapshot.meta.sample).toBe(false);
  });
});
