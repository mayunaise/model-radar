import { resolve } from "node:path";
import { loadProjectConfig } from "../src/lib/config/load";
import { loadDataSnapshot } from "../src/lib/data/load";
import { qualityAuditReportSchema } from "../src/lib/domain/schemas";
import type { ActivityItem } from "../src/lib/domain/types";
import { auditSample, type AuditSource } from "./quality/audit";
import { createGitCodeGateway } from "./sync/gitcode";
import { createGitHubGateway } from "./sync/github";
import { repositorySource, splitSourceSlug } from "./sync/source";
import { writeJsonAtomic } from "./sync/store";
import type { Repository } from "./sync/types";

function beijingDate(timestamp = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(timestamp);
}

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function githubState(state: string): "open" | "closed" {
  if (state === "open" || state === "closed") return state;
  throw new Error(`Unexpected GitHub state: ${state}`);
}

function createAuditSource(repositoriesBySlug: Map<string, Repository>): AuditSource {
  const githubToken = process.env.GITHUB_TOKEN?.trim();
  const gitCodeToken = process.env.GITCODE_TOKEN?.trim();
  const github = createGitHubGateway(githubToken);
  const gitcode = createGitCodeGateway(gitCodeToken);
  return {
    async get(item: ActivityItem) {
      const repository = repositoriesBySlug.get(item.repository);
      if (!repository) throw new Error(`Unknown audited repository: ${item.repository}`);
      const source = repositorySource(repository);
      const gateway = source.provider === "gitcode" ? gitcode : github;
      const [owner, repo] = splitSourceSlug(source.slug);
      if (item.type === "pr") {
        const response = await gateway.getPull({ owner, repo, number: item.number });
        return {
          title: response.item.title,
          state: response.item.merged_at ? "merged" as const : githubState(response.item.state),
          updatedAt: response.item.updated_at,
          url: response.item.html_url,
        };
      }
      if (!gateway.getIssue) throw new Error("GitHub issue lookup is unavailable");
      const response = await gateway.getIssue({ owner, repo, number: item.number });
      return {
        title: response.item.title,
        state: githubState(response.item.state),
        updatedAt: response.item.updated_at,
        url: response.item.html_url,
      };
    },
  };
}

const positionalRoot = process.argv.slice(2).find((argument, index, args) => (
  !argument.startsWith("--") && (index === 0 || !args[index - 1]?.startsWith("--"))
));
const root = resolve(positionalRoot ?? process.env.GLM_DATA_DIR ?? "../data");
const date = option("--date") ?? beijingDate();
const samplePerStratum = Number(option("--sample-per-stratum") ?? 2);
const [snapshot, config] = await Promise.all([loadDataSnapshot(root), loadProjectConfig()]);
const enabled = new Set(config.repositories.repositories.filter((repository) => repository.enabled).map((repository) => repository.slug));
const repositoriesBySlug = new Map(config.repositories.repositories.map((repository) => [repository.slug, repository]));
const dailyReport = snapshot.reports.find((report) => report.date === date);
if (!dailyReport) throw new Error(`Daily report not found for relevance audit: ${date}`);
const dailyItemIds = new Set(dailyReport.groups.flatMap((group) => group.itemIds));
const dailyItems = snapshot.items.filter((item) => dailyItemIds.has(item.id) && enabled.has(item.repository));
if (dailyItems.length !== dailyItemIds.size) {
  throw new Error(`Daily relevance audit cannot resolve every report item: expected ${dailyItemIds.size}, found ${dailyItems.length}`);
}
const report = qualityAuditReportSchema.parse(await auditSample({
  items: dailyItems,
  date,
  categories: config.categories,
  keywords: config.keywords,
  source: createAuditSource(repositoriesBySlug),
  samplePerStratum,
  auditAll: true,
}));
const [year, month, day] = date.split("-");
await writeJsonAtomic(root, `quality/${year}/${month}/${day}.json`, report);
process.stdout.write(`${JSON.stringify(report.summary)}\n`);
if (report.summary.structuralFailures > 0 || report.summary.relevanceFailures > 0) process.exitCode = 1;
