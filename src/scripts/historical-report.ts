import type { ActivityItem, DailyReport, RepositoryConfig } from "../lib/domain/types";

type ClientIndex = {
  items: Record<string, { shard: string; path: string }>;
};
type ClientConfig = { repositories: RepositoryConfig["repositories"] };

async function getJson<T>(base: string, path: string): Promise<T> {
  const response = await fetch(`${base}data/${path}`);
  if (!response.ok) throw new Error(`Unable to load ${path}`);
  return response.json() as Promise<T>;
}

function text<K extends keyof HTMLElementTagNameMap>(tag: K, value: string, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.textContent = value;
  if (className) node.className = className;
  return node;
}

export async function loadHistoricalReport(): Promise<void> {
  const root = document.querySelector<HTMLElement>("[data-historical-report]");
  if (!root) return;
  const loading = root.querySelector<HTMLElement>("[data-loading]")!;
  const base = root.dataset.siteBase ?? "/";
  try {
    const date = new URLSearchParams(location.search).get("date");
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("缺少有效的日报日期");
    const [report, index, config] = await Promise.all([
      getJson<DailyReport>(base, `reports/${date.replaceAll("-", "/")}.json`),
      getJson<ClientIndex>(base, "client-index.json"),
      getJson<ClientConfig>(base, "config.json"),
    ]);
    const ids = [...new Set(report.groups.flatMap((group) => group.itemIds))];
    const shards = [...new Set(ids.flatMap((id) => index.items[id]?.shard ? [index.items[id].shard] : []))];
    const items = (await Promise.all(shards.map((shard) => getJson<ActivityItem[]>(base, shard)))).flat();
    const byId = new Map(items.map((item) => [item.id, item]));
    const dailyItems = ids.flatMap((id) => byId.get(id) ?? []);
    root.querySelector<HTMLElement>("[data-date]")!.textContent = report.date;
    root.querySelector<HTMLElement>("[data-intro]")!.textContent = report.intro;
    root.querySelector<HTMLElement>("[data-count]")!.textContent = `${dailyItems.length} 条`;
    const groupsRoot = root.querySelector<HTMLElement>("[data-groups]")!;
    const states = { open: "进行中", closed: "已关闭", merged: "已合并" };
    for (const type of ["issue", "pr"] as const) {
      const groupItems = dailyItems.filter((item) => item.type === type);
      const section = document.createElement("section");
      section.className = "daily-type-group";
      const heading = document.createElement("div");
      heading.className = "daily-type-heading";
      heading.append(text("h3", type === "pr" ? "PR" : "Issue"), text("span", `${groupItems.length} 条`));
      const scroll = document.createElement("div");
      scroll.className = "daily-scroll-region";
      if (groupItems.length === 0) scroll.append(text("p", `今日暂无 ${type === "pr" ? "PR" : "Issue"}。`, "empty"));
      else {
        const list = document.createElement("ol");
        for (const item of groupItems) {
          const li = document.createElement("li");
          const link = document.createElement("a");
          link.href = `${base}${index.items[item.id].path}`;
          link.append(text("span", `${type === "pr" ? "PR" : "Issue"} #${item.number}`, "reference"), text("strong", item.title));
          if (item.summary?.summaryZh) link.append(text("p", item.summary.summaryZh));
          const badges = document.createElement("div");
          badges.className = "daily-item-badges";
          const repository = config.repositories.find((candidate) => candidate.slug === item.repository);
          badges.append(text("span", repository?.framework ?? item.repository, "tag"), text("span", states[item.state], "tag"));
          li.append(link, badges);
          list.append(li);
        }
        scroll.append(list);
      }
      section.append(heading, scroll);
      groupsRoot.append(section);
    }
    document.title = `${report.date} 日报｜GLM Radar`;
    loading.hidden = true;
    root.querySelector<HTMLElement>("[data-content]")!.hidden = false;
  } catch (error) {
    loading.textContent = error instanceof Error ? error.message : "历史日报加载失败";
  }
}
