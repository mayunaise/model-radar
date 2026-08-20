import { cp, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { describe, expect, test } from "vitest";
import { runSyncPipeline } from "../../scripts/sync/pipeline";
import type { GitHubGateway } from "../../scripts/sync/types";

const fixtures = resolve(import.meta.dirname, "../../fixtures/bootstrap-data");

async function dataCopy() {
  const root = await mkdtemp(join(tmpdir(), "glm-pipeline-"));
  await cp(fixtures, root, { recursive: true });
  return root;
}

const emptyGateway: GitHubGateway = {
  async listIssues() {
    return { items: [], rateLimit: { remaining: 4999, resetAt: "2026-08-20T12:00:00.000Z" } };
  },
  async getPull() {
    throw new Error("not expected");
  },
};

describe("sync orchestration", () => {
  test("dry-run reports collection without writing files", async () => {
    const root = await dataCopy();
    const before = await readFile(join(root, "meta.json"), "utf8");
    const result = await runSyncPipeline({ dataDir: root, gateway: emptyGateway, now: "2026-08-21T00:30:00.000Z", dryRun: true });

    expect(result.collected).toBe(0);
    expect(await readFile(join(root, "meta.json"), "utf8")).toBe(before);
  });

  test("repeated empty syncs remain duplicate-free", async () => {
    const root = await dataCopy();
    await runSyncPipeline({ dataDir: root, gateway: emptyGateway, now: "2026-08-21T00:30:00.000Z" });
    await runSyncPipeline({ dataDir: root, gateway: emptyGateway, now: "2026-08-21T00:31:00.000Z" });
    const shard = JSON.parse(await readFile(join(root, "items/2026/08.json"), "utf8"));

    expect(shard).toHaveLength(4);
    expect(new Set(shard.map((entry: { nodeId: string }) => entry.nodeId)).size).toBe(4);
  });
});
