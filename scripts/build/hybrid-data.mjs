import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export const HYBRID_PRERENDER_DAYS = 30;

function routeKey(repository) {
  return repository.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function cutoffDate(anchorDate) {
  const anchor = new Date(`${anchorDate}T00:00:00.000Z`);
  anchor.setUTCDate(anchor.getUTCDate() - (HYBRID_PRERENDER_DAYS - 1));
  return anchor.toISOString().slice(0, 10);
}

function beijingDate(timestamp) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(timestamp));
}

async function json(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function listJsonFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const child = resolve(directory, entry.name);
    if (entry.isDirectory()) return listJsonFiles(child);
    return entry.isFile() && entry.name.endsWith(".json") ? [child] : [];
  }));
  return files.flat().sort();
}

async function writeJson(root, relativePath, value) {
  const target = resolve(root, relativePath);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function exportHybridData({ dataRoot, outputRoot, configRoot }) {
  const [meta, repositoriesConfig, categories, itemFiles, reportFiles] = await Promise.all([
    json(resolve(dataRoot, "meta.json")),
    json(resolve(configRoot, "repositories.json")),
    json(resolve(configRoot, "categories.json")),
    listJsonFiles(resolve(dataRoot, "items")),
    listJsonFiles(resolve(dataRoot, "reports")),
  ]);
  const enabledRepositories = repositoriesConfig.repositories.filter((repository) => repository.enabled);
  const enabledSlugs = new Set(enabledRepositories.map((repository) => repository.slug));
  const anchorDate = meta.latestReportDate;
  const cutoff = cutoffDate(anchorDate);
  const index = {
    schemaVersion: 1,
    anchorDate,
    cutoffDate: cutoff,
    items: {},
    routes: {},
    reports: {},
  };

  await rm(outputRoot, { recursive: true, force: true });
  await mkdir(outputRoot, { recursive: true });

  const publishedIds = new Set();
  for (const file of itemFiles) {
    const relative = file.slice(resolve(dataRoot).length + 1).replaceAll("\\", "/");
    const items = (await json(file)).filter((item) => enabledSlugs.has(item.repository));
    if (items.length === 0) continue;
    await writeJson(outputRoot, relative, items);
    for (const item of items) {
      publishedIds.add(item.id);
      const route = `${routeKey(item.repository)}/${item.type}/${item.number}`;
      const recent = beijingDate(item.updatedAt) >= cutoff;
      index.items[item.id] = {
        shard: relative,
        path: recent
          ? `activity/${route}/`
          : `activity/detail/?id=${encodeURIComponent(item.id)}`,
      };
      index.routes[route] = item.id;
    }
  }

  for (const file of reportFiles) {
    const relative = file.slice(resolve(dataRoot).length + 1).replaceAll("\\", "/");
    const report = await json(file);
    const groups = report.groups.map((group) => ({
      ...group,
      itemIds: group.itemIds.filter((id) => publishedIds.has(id)),
    }));
    const count = groups.reduce((total, group) => total + group.itemIds.length, 0);
    const published = { ...report, groups };
    if (count !== report.groups.reduce((total, group) => total + group.itemIds.length, 0)) {
      published.intro = count ? `今日新增或更新 ${count} 条 GLM 相关动态。` : "今日暂无新增或更新的 GLM 相关动态。";
    }
    await writeJson(outputRoot, relative, published);
    index.reports[report.date] = {
      path: report.date >= cutoff
        ? `reports/${report.date}/`
        : `reports/detail/?date=${encodeURIComponent(report.date)}`,
    };
  }

  await Promise.all([
    writeJson(outputRoot, "client-index.json", index),
    writeJson(outputRoot, "config.json", { repositories: enabledRepositories, categories }),
  ]);
  return index;
}
