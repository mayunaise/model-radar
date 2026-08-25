import { pathToFileURL } from "node:url";
import { loadDataSnapshot } from "../src/lib/data/load";
import type { ActivityItem, SearchDocument } from "../src/lib/domain/types";
import { modelNamesForItem } from "../src/lib/domain/models";
import { categoryForItem } from "../src/lib/domain/classification";
import { searchIndexSchema } from "../src/lib/domain/schemas";
import { writeJsonAtomic } from "./sync/store";

export function buildSearchIndex(items: ActivityItem[]): SearchDocument[] {
  return searchIndexSchema.parse(
    [...items]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id))
      .map((item) => ({
        id: item.id,
        title: item.title,
        summary: item.summary?.summaryZh ?? "",
        repository: item.repository,
        type: item.type,
        state: item.state,
        category: categoryForItem(item),
        updatedAt: item.updatedAt,
        url: item.url,
        models: modelNamesForItem(item),
      })),
  );
}

async function main() {
  const dataDir = process.argv[2];
  const snapshot = await loadDataSnapshot(dataDir);
  await writeJsonAtomic(snapshot.root, "search-index.json", buildSearchIndex(snapshot.items));
  process.stdout.write(`Built search index with ${snapshot.items.length} documents.\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
