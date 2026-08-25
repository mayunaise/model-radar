import type { ActivityItem, CategoryConfig, RepositoryConfig } from "../lib/domain/types";

type ClientIndex = {
  items: Record<string, { shard: string; path: string }>;
};
type ClientConfig = {
  repositories: RepositoryConfig["repositories"];
  categories: CategoryConfig;
};

function element<T extends HTMLElement>(root: ParentNode, selector: string): T {
  const found = root.querySelector<T>(selector);
  if (!found) throw new Error(`Missing historical detail element: ${selector}`);
  return found;
}

async function getJson<T>(base: string, path: string): Promise<T> {
  const response = await fetch(`${base}data/${path}`);
  if (!response.ok) throw new Error(`Unable to load ${path}`);
  return response.json() as Promise<T>;
}

export async function loadHistoricalItem(): Promise<void> {
  const root = document.querySelector<HTMLElement>("[data-historical-item]");
  if (!root) return;
  const base = root.dataset.siteBase ?? "/";
  const loading = element<HTMLElement>(root, "[data-loading]");
  try {
    const id = new URLSearchParams(location.search).get("id");
    if (!id) throw new Error("缺少动态编号");
    const [index, config] = await Promise.all([
      getJson<ClientIndex>(base, "client-index.json"),
      getJson<ClientConfig>(base, "config.json"),
    ]);
    const entry = index.items[id];
    if (!entry) throw new Error("没有找到这条历史动态");
    const items = await getJson<ActivityItem[]>(base, entry.shard);
    const item = items.find((candidate) => candidate.id === id);
    if (!item) throw new Error("历史动态归档不完整");
    const repository = config.repositories.find((candidate) => candidate.slug === item.repository);
    const category = item.category ?? item.summary?.category ?? "OTHER";
    const categoryLabel = config.categories.categories.find((candidate) => candidate.code === category)?.labels[item.type] ?? "其他";
    const stateLabels = { open: "进行中", closed: "已关闭", merged: "已合并" };

    element(root, "[data-repository]").textContent = repository?.framework ?? item.repository;
    element(root, "[data-repository]").style.setProperty("--repo-color", repository?.color ?? "#A86845");
    const state = element(root, "[data-state]");
    state.textContent = stateLabels[item.state];
    state.dataset.value = item.state;
    element(root, "[data-reference]").textContent = `${item.type === "pr" ? "Pull Request" : "Issue"} #${item.number}`;
    element(root, "[data-headline]").textContent = item.summary?.headlineZh ?? item.title;
    element(root, "[data-title]").textContent = item.title;
    element(root, "[data-summary]").textContent = item.summary?.summaryZh ?? "摘要待生成，请查看上游原文。";
    element(root, "[data-author]").textContent = item.author;
    element(root, "[data-updated]").textContent = new Date(item.updatedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
    element(root, "[data-category]").textContent = categoryLabel;
    element(root, "[data-severity]").textContent = item.summary?.severity ?? "待判断";
    const evidence = element<HTMLUListElement>(root, "[data-evidence]");
    for (const value of item.summary?.evidence ?? item.labels) {
      const li = document.createElement("li");
      li.textContent = value;
      evidence.append(li);
    }
    const source = element<HTMLAnchorElement>(root, "[data-source]");
    source.href = item.url;
    document.title = `${item.summary?.headlineZh ?? item.title}｜GLM Radar`;
    loading.hidden = true;
    element<HTMLElement>(root, "[data-content]").hidden = false;
  } catch (error) {
    loading.textContent = error instanceof Error ? error.message : "历史动态加载失败";
  }
}
