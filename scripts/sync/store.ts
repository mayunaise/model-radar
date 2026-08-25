import { mkdir, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import type { ActivityItem, RepositoryConfig } from "../../src/lib/domain/types";
import { dataPath } from "../../src/lib/data/paths";

export async function writeJsonAtomic(root: string, path: string, value: unknown): Promise<void> {
  const target = dataPath(resolve(root), path);
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, target);
}

export function mergeItems(existing: ActivityItem[], incoming: ActivityItem[]): ActivityItem[] {
  const byNode = new Map(existing.map((item) => [item.nodeId, item]));
  for (const item of incoming) {
    const current = byNode.get(item.nodeId);
    if (!current || item.updatedAt >= current.updatedAt) byNode.set(item.nodeId, item);
  }
  return [...byNode.values()].sort(
    (left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id),
  );
}

export function itemShard(
  item: ActivityItem,
  repositories: RepositoryConfig["repositories"],
): string {
  const repository = repositories.find((entry) => entry.slug === item.repository);
  if (!repository) throw new Error(`Unknown repository: ${item.repository}`);
  const [year, month] = item.createdAt.slice(0, 7).split("-");
  return `items/${repository.dataKey}/${year}/${month}.json`;
}

export async function writeItemShards(
  root: string,
  items: ActivityItem[],
  repositories: RepositoryConfig["repositories"],
  previousItems: ActivityItem[] = [],
): Promise<void> {
  const shards = new Map<string, ActivityItem[]>();
  for (const item of previousItems) shards.set(itemShard(item, repositories), []);
  for (const item of items) {
    const path = itemShard(item, repositories);
    shards.set(path, [...(shards.get(path) ?? []), item]);
  }
  for (const [path, shardItems] of shards) await writeJsonAtomic(root, path, shardItems);
}
