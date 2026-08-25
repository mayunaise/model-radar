import { createHash } from "node:crypto";
import { loadProjectConfig } from "../../src/lib/config/load";
import { loadDataSnapshot } from "../../src/lib/data/load";
import type { ActivityItem, CapabilityCandidate, DataEvent, Manifest } from "../../src/lib/domain/types";
import { withActivityClassification } from "../../src/lib/domain/classification";
import { buildSearchIndex } from "../build-search-index";
import { BudgetLedger, estimateTokens } from "./budget";
import { backfillMissingDailyReports, hasMeaningfulChange, mergeDailyReport, reconcileHistoricalDailyReports } from "./daily-report";
import { collectRepository, collectRepositoryPage, collectRepositorySearchPage, GITHUB_RATE_LIMIT_FLOOR } from "./github";
import { normalizeGitHubItem } from "./normalize";
import type { ResponsesClient } from "./openai";
import { isSummaryContentError, summarizeCandidate } from "./openai";
import { candidateInput, SUMMARY_PROMPT_VERSION } from "./prompts";
import { scoreRelevance } from "./relevance";
import { repositorySource } from "./source";
import { itemShard, mergeItems, writeItemShards, writeJsonAtomic } from "./store";
import type { GitHubGateway, RawGitHubItem, SourceProvider } from "./types";

type PipelineInput = {
  dataDir: string;
  gateway?: GitHubGateway;
  sourceGateways?: Partial<Record<SourceProvider, GitHubGateway>>;
  responsesClient?: ResponsesClient;
  projectConfig?: Awaited<ReturnType<typeof loadProjectConfig>>;
  now: string;
  dryRun?: boolean;
  maxAiItemsThisRun?: number;
  fullSummaryBackfill?: boolean;
  fullSourceBackfill?: boolean;
  repositorySlug?: string;
  aiSummaryConcurrency?: number;
  onProgress?: (message: string) => void;
};

export function reusableSummary(
  previous: Pick<ActivityItem, "title" | "state" | "summary"> | undefined,
  next: Pick<ActivityItem, "title" | "state">,
): ActivityItem["summary"] {
  if (!previous?.summary || previous.summary.promptVersion !== SUMMARY_PROMPT_VERSION) return null;
  return previous.title === next.title && previous.state === next.state
    ? previous.summary
    : null;
}

export function migrationFallbackSummary(
  previous: Pick<ActivityItem, "title" | "state" | "summary"> | undefined,
  next: Pick<ActivityItem, "title" | "state">,
): ActivityItem["summary"] {
  if (!previous?.summary) return null;
  return previous.title === next.title && previous.state === next.state
    ? previous.summary
    : null;
}

export function orderSummaryCandidates<T extends Pick<ActivityItem, "nodeId" | "updatedAt">>(
  candidates: T[],
  incrementalNodeIds: Set<string>,
  dailyReportNodeIds: Set<string>,
): T[] {
  const priority = (candidate: T) => (
    incrementalNodeIds.has(candidate.nodeId) ? 0
      : dailyReportNodeIds.has(candidate.nodeId) ? 1
        : 2
  );
  return [...candidates].sort((left, right) => {
    const leftPriority = priority(left);
    const rightPriority = priority(right);
    if (leftPriority !== rightPriority) return leftPriority - rightPriority;
    return leftPriority < 2
      ? right.updatedAt.localeCompare(left.updatedAt)
      : left.updatedAt.localeCompare(right.updatedAt);
  });
}

const SEARCH_BACKFILL_PAGE_LIMIT = 10;
export const GITHUB_SYNC_CONCURRENCY = 2;
export const AI_SUMMARY_CONCURRENCY = 3;

export async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  task: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error("concurrency must be a positive integer");
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const worker = async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= values.length) return;
      results[index] = await task(values[index]!, index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker));
  return results;
}

function beijingDate(timestamp: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(timestamp));
}

function hash(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

export async function runSyncPipeline(input: PipelineInput) {
  const [snapshot, config] = await Promise.all([
    loadDataSnapshot(input.dataDir),
    input.projectConfig ?? loadProjectConfig(),
  ]);
  const date = beijingDate(input.now);
  const previousBudget = snapshot.meta.ai.budgetDate === date
    ? {
        itemCount: snapshot.meta.ai.itemsSummarized,
        estimatedCostUsd: snapshot.meta.ai.estimatedCostUsd ?? 0,
        actualInputTokens: snapshot.meta.ai.inputTokens,
        actualOutputTokens: snapshot.meta.ai.outputTokens,
      }
    : undefined;
  const ledger = new BudgetLedger(config.openai, previousBudget);
  const maxAiItemsThisRun = input.maxAiItemsThisRun ?? (input.fullSummaryBackfill ? Number.MAX_SAFE_INTEGER : config.openai.dailyItemLimit);
  if (!Number.isInteger(maxAiItemsThisRun) || maxAiItemsThisRun < 1 || (!input.fullSummaryBackfill && maxAiItemsThisRun > config.openai.dailyItemLimit)) {
    throw new Error(input.fullSummaryBackfill
      ? "maxAiItemsThisRun must be a positive integer"
      : "maxAiItemsThisRun must be between 1 and the configured daily item limit");
  }
  const aiSummaryConcurrency = input.aiSummaryConcurrency ?? AI_SUMMARY_CONCURRENCY;
  if (!Number.isInteger(aiSummaryConcurrency) || aiSummaryConcurrency < 1 || aiSummaryConcurrency > AI_SUMMARY_CONCURRENCY) {
    throw new Error(`aiSummaryConcurrency must be between 1 and ${AI_SUMMARY_CONCURRENCY}`);
  }
  const collected = [];
  const summaryConfig = input.fullSummaryBackfill
    ? { ...config.openai, maxRetries: Math.max(config.openai.maxRetries, 3) }
    : config.openai;
  const incrementalNodeIds = new Set<string>();
  if (input.fullSourceBackfill && !input.repositorySlug) {
    throw new Error("fullSourceBackfill requires an explicit repositorySlug");
  }
  const requestedRepository = input.repositorySlug
    ? config.repositories.repositories.find((repository) => repository.slug === input.repositorySlug)
    : undefined;
  if (input.repositorySlug && !requestedRepository?.enabled) {
    throw new Error(`Requested repository is not enabled or configured: ${input.repositorySlug}`);
  }
  const enabledRepositories = config.repositories.repositories.filter((repo) => (
    repo.enabled && (!input.repositorySlug || repo.slug === input.repositorySlug)
  ));
  const nextBackfill: Manifest["backfill"] = { ...snapshot.manifest.backfill };
  const nextSearchBackfill: Manifest["searchBackfill"] = { ...snapshot.manifest.searchBackfill };
  const nextCursors: Manifest["cursors"] = { ...snapshot.manifest.cursors };
  const configuredSources = Object.fromEntries(config.repositories.repositories.map((repository) => [
    repository.slug,
    repositorySource(repository),
  ])) satisfies Manifest["sources"];
  for (const repository of enabledRepositories) {
    const source = repositorySource(repository);
    const previousSource = snapshot.manifest.sources[repository.slug];
    const sourceChanged = previousSource
      ? previousSource.provider !== source.provider || previousSource.slug !== source.slug
      : source.provider !== "github" || source.slug !== (repository.canonicalSlug ?? repository.slug);
    if (sourceChanged) {
      // Begin routine collection at the switch time and restart bounded history
      // backfill. This avoids an unbounded first request while still making the
      // source migration resumable across daily runs.
      nextCursors[repository.slug] = input.now;
      nextBackfill[repository.slug] = {
        status: "pending",
        nextPage: 1,
        historyStartAt: repository.historyStartAt,
      };
      delete nextSearchBackfill[repository.slug];
    } else {
      nextCursors[repository.slug] ??= snapshot.meta.lastSuccessfulSyncAt;
    }
  }
  let rateLimitStop = false;
  let responsesClient = input.responsesClient;
  let summaryOperational = Boolean(responsesClient);
  let summaryStopReason: "openai-key-missing" | "openai-unavailable" | "run-item-limit" | "daily-item-limit" | "daily-budget" | null = responsesClient
    ? null
    : "openai-key-missing";

  const repositoryResults = await mapWithConcurrency(
    enabledRepositories,
    GITHUB_SYNC_CONCURRENCY,
    async (repository, repositoryIndex) => {
      if (rateLimitStop) return { items: [], incrementalItems: [] };
      const source = repositorySource(repository);
      input.onProgress?.(`${source.provider === "github" ? "GitHub" : "GitCode"} ${repositoryIndex + 1}/${enabledRepositories.length}: ${repository.framework}`);
      const gateway = input.sourceGateways
        ? input.sourceGateways[source.provider]
        : input.gateway;
      if (!gateway) throw new Error(`No ${source.provider} source gateway configured for ${repository.slug}`);
      const repositoryItems = [];
      const since = nextCursors[repository.slug];
      const shouldExpandPull = (raw: RawGitHubItem) => (
        scoreRelevance(
          normalizeGitHubItem(raw, repository.slug, "pr", input.now),
          config.keywords,
        ).disposition !== "excluded"
      );
      const result = await collectRepository(
        gateway,
        repository,
        since,
        input.now,
        shouldExpandPull,
        () => rateLimitStop,
      );
      repositoryItems.push(...result.items);
      if (result.complete) nextCursors[repository.slug] = input.now;
      if (result.rateLimit.remaining < GITHUB_RATE_LIMIT_FLOOR) {
        rateLimitStop = true;
        return { items: repositoryItems, incrementalItems: result.items };
      }

      if (gateway.searchIssuesPage) {
        let searchBackfill = nextSearchBackfill[repository.slug] ?? {
          status: "pending" as const,
          type: "issue" as const,
          nextPage: 1,
          queryVersion: "glm-title-v1" as const,
        };
        if (searchBackfill.status === "complete") return { items: repositoryItems, incrementalItems: result.items };

        const searchPageLimit = input.fullSourceBackfill ? Number.MAX_SAFE_INTEGER : SEARCH_BACKFILL_PAGE_LIMIT;
        for (let pageCount = 0; pageCount < searchPageLimit; pageCount += 1) {
          if (input.fullSourceBackfill) input.onProgress?.(`Source backfill ${repository.framework}: ${searchBackfill.type} page ${searchBackfill.nextPage}`);
          const page = await collectRepositorySearchPage(
            gateway,
            repository,
            { type: searchBackfill.type, page: searchBackfill.nextPage },
            input.now,
            shouldExpandPull,
          );
          repositoryItems.push(...page.items);
          if (page.pageComplete) {
            if (page.hasNextPage) {
              searchBackfill = { ...searchBackfill, status: "running", nextPage: searchBackfill.nextPage + 1 };
            } else if (searchBackfill.type === "issue") {
              searchBackfill = { ...searchBackfill, status: "running", type: "pr", nextPage: 1 };
            } else {
              searchBackfill = { ...searchBackfill, status: "complete", nextPage: searchBackfill.nextPage + 1 };
            }
            nextSearchBackfill[repository.slug] = searchBackfill;
          }
          if (page.rateLimitStop) {
            rateLimitStop = true;
            break;
          }
          if (searchBackfill.status === "complete") break;
        }
        return { items: repositoryItems, incrementalItems: result.items };
      }

      let backfill = nextBackfill[repository.slug] ?? {
        status: "pending" as const,
        nextPage: 1,
        historyStartAt: repository.historyStartAt,
      };
      if (backfill.status === "complete") return { items: repositoryItems, incrementalItems: result.items };

      const backfillPageLimit = input.fullSourceBackfill ? Number.MAX_SAFE_INTEGER : repository.backfillPageLimit;
      for (let pageCount = 0; pageCount < backfillPageLimit; pageCount += 1) {
        if (input.fullSourceBackfill) input.onProgress?.(`Source backfill ${repository.framework}: page ${backfill.nextPage}`);
        const page = await collectRepositoryPage(
          gateway,
          repository,
          { page: backfill.nextPage, sort: "created", direction: "asc" },
          input.now,
          shouldExpandPull,
        );
        repositoryItems.push(...page.items);
        if (page.pageComplete) {
          backfill = {
            ...backfill,
            status: page.hasNextPage ? "running" : "complete",
            nextPage: backfill.nextPage + 1,
          };
          nextBackfill[repository.slug] = backfill;
        }
        if (page.rateLimit.remaining < GITHUB_RATE_LIMIT_FLOOR) {
          rateLimitStop = true;
          break;
        }
        if (!page.hasNextPage) break;
      }
      return { items: repositoryItems, incrementalItems: result.items };
    },
  );
  for (const result of repositoryResults) {
    collected.push(...result.items);
    result.incrementalItems.forEach((item) => incrementalNodeIds.add(item.nodeId));
  }

  const collectedNodeIds = new Set(collected.map((item) => item.nodeId));
  const enabledRepositorySlugs = new Set(enabledRepositories.map((repository) => repository.slug));
  const pendingSummaryCandidates = snapshot.items
    .filter((item) => (
      (!item.summary || item.summary.promptVersion !== SUMMARY_PROMPT_VERSION)
      && enabledRepositorySlugs.has(item.repository)
    ))
    .map(({ summary: _summary, ...candidate }) => candidate);
  const candidateByNode = new Map<string, (typeof collected)[number]>();
  for (const candidate of [...collected, ...pendingSummaryCandidates]) {
    const current = candidateByNode.get(candidate.nodeId);
    if (!current || candidate.updatedAt >= current.updatedAt) candidateByNode.set(candidate.nodeId, candidate);
  }
  const existingDailyReportItemIds = new Set(
    snapshot.reports.find((report) => report.date === date)?.groups.flatMap((group) => group.itemIds) ?? [],
  );
  const dailyReportNodeIds = new Set(
    snapshot.items.filter((item) => existingDailyReportItemIds.has(item.id)).map((item) => item.nodeId),
  );
  const deduplicated = orderSummaryCandidates([...candidateByNode.values()], incrementalNodeIds, dailyReportNodeIds);

  const completed: ActivityItem[] = [];
  const candidates: CapabilityCandidate[] = [...snapshot.candidates];
  let backlogCount = 0;
  let successfulSummariesThisRun = 0;
  let aiCallsThisRun = 0;
  const existingByNode = new Map(snapshot.items.map((item) => [item.nodeId, item]));
  const processedCandidates = await mapWithConcurrency(deduplicated, aiSummaryConcurrency, async (candidate) => {
    const relevance = scoreRelevance(candidate, config.keywords);
    if (relevance.disposition === "excluded") return null;
    const existing = existingByNode.get(candidate.nodeId);
    const candidateWithHistory = existing ? { ...candidate, firstSeenAt: existing.firstSeenAt } : candidate;
    // Summary generation intentionally reacts only to user-visible title and
    // lifecycle state changes. Body edits, labels, comments, and updatedAt are
    // still synchronized, but must not spend AI budget regenerating a summary.
    let summary = reusableSummary(existing, candidate);
    const migrationFallback = migrationFallbackSummary(existing, candidate);
    if (!summary && responsesClient) {
      if (aiCallsThisRun >= maxAiItemsThisRun) {
        backlogCount += 1;
        summaryStopReason = "run-item-limit";
      } else {
        const inputTokens = estimateTokens(candidateInput(candidate));
        const reservation = input.fullSummaryBackfill
          ? ledger.reserveItemUnbounded(inputTokens, config.openai.itemMaxOutputTokens)
          : ledger.reserveItem(inputTokens, config.openai.itemMaxOutputTokens);
        if (reservation.allowed) {
          const client = responsesClient;
          try {
            aiCallsThisRun += 1;
            input.onProgress?.(`AI summary ${aiCallsThisRun}/${input.fullSummaryBackfill ? "all" : maxAiItemsThisRun}: ${candidate.repository}#${candidate.number}`);
            const result = await summarizeCandidate(client, candidateWithHistory, summaryConfig, input.now, config.categories);
            summary = result.summary;
            ledger.recordActualUsage(result.usage.inputTokens, result.usage.outputTokens);
            successfulSummariesThisRun += 1;
          } catch (error) {
            backlogCount += 1;
            if (isSummaryContentError(error)) {
              const details = typeof error === "object" && error && "issues" in error
                ? JSON.stringify((error as { issues: unknown }).issues)
                : error instanceof Error ? error.message : String(error);
              const reason = details.replace(/\s+/gu, " ").slice(0, 500);
              input.onProgress?.(`AI summary rejected ${candidate.repository}#${candidate.number}: ${reason}`);
            }
            // A malformed model response belongs to this item. Keep the AI
            // pipeline available for later items; only transport/API failures
            // switch the whole run to GitHub-only mode. Up to two already
            // running requests may still finish after this transition.
            if (!isSummaryContentError(error)) {
              responsesClient = undefined;
              summaryOperational = false;
              summaryStopReason = "openai-unavailable";
            }
          }
        } else {
          backlogCount += 1;
          responsesClient = undefined;
          summaryStopReason = reservation.reason;
        }
      }
    } else if (!summary) backlogCount += 1;

    // During a prompt-version migration, publish the previous summary until a
    // replacement succeeds. Never erase useful content because a run hits its
    // item/cost limit or the AI endpoint is temporarily unavailable. A title
    // or lifecycle-state change deliberately has no fallback because the old
    // summary may then be misleading.
    summary ??= migrationFallback;
    const item: ActivityItem = withActivityClassification({ ...candidateWithHistory, summary });
    const capabilityCandidate = summary?.capabilityCandidate || relevance.disposition === "review"
      ? { id: `${candidate.nodeId}-${candidate.contentHash}`, itemId: candidate.id, reasonZh: "检测到可能影响能力矩阵的上游变更，需维护者核实证据。", suggestedAction: "review" as const, generatedAt: input.now }
      : null;
    return { item, capabilityCandidate };
  });
  for (const processed of processedCandidates) {
    if (!processed) continue;
    completed.push(processed.item);
    if (processed.capabilityCandidate) candidates.push(processed.capabilityCandidate);
  }

  const merged = mergeItems(snapshot.items, completed)
    .filter((item) => (
      !enabledRepositorySlugs.has(item.repository)
      || scoreRelevance(item, config.keywords).disposition !== "excluded"
    ))
    .map(withActivityClassification);
  if (input.dryRun) return {
    collected: collected.length,
    published: completed.filter((item) => collectedNodeIds.has(item.nodeId)).length,
    backlogCount,
    rateLimitStop,
    summaryMode: summaryOperational ? "enabled" as const : "github-only" as const,
    summaryStopReason,
  };

  const oldByNode = new Map(snapshot.items.map((item) => [item.nodeId, item]));
  const newEvents: DataEvent[] = completed
    .filter((item) => oldByNode.get(item.nodeId)?.state !== item.state)
    .map((item) => ({ id: `${item.nodeId}-state-${hash(item.state)}`, itemId: item.id, type: "state", oldValue: oldByNode.get(item.nodeId)?.state ?? null, newValue: item.state, occurredAt: item.updatedAt }));
  const allEvents = [...snapshot.events, ...newEvents];
  const dailyDelta = completed.filter((item) => incrementalNodeIds.has(item.nodeId) && hasMeaningfulChange(oldByNode.get(item.nodeId), item));
  const existingReport = snapshot.reports.find((report) => report.date === date);
  const latestReport = mergeDailyReport(date, existingReport, dailyDelta, merged, input.now);
  const missingReports = input.fullSummaryBackfill
    ? backfillMissingDailyReports(
        [...snapshot.reports.filter((report) => report.date !== latestReport.date), latestReport],
        merged,
        allEvents,
        input.now,
      )
    : [];
  const reportsToWrite = input.fullSummaryBackfill
    ? reconcileHistoricalDailyReports(
        [...snapshot.reports.filter((report) => report.date !== latestReport.date), latestReport, ...missingReports],
        merged,
        allEvents,
        input.now,
      )
    : [latestReport];
  const budget = ledger.snapshot();
  const manifest: Manifest = {
    schemaVersion: 1,
    items: Object.fromEntries(merged.map((item) => [item.nodeId, { shard: itemShard(item, config.repositories.repositories), contentHash: item.contentHash, summaryHash: item.summary ? hash(item.summary) : null, updatedAt: item.updatedAt }])),
    cursors: nextCursors,
    backfill: nextBackfill,
    searchBackfill: nextSearchBackfill,
    sources: configuredSources,
  };
  const monthPath = input.now.slice(0, 7).replace("-", "/");

  await writeItemShards(snapshot.root, merged, config.repositories.repositories, snapshot.items);
  await Promise.all([
    writeJsonAtomic(snapshot.root, "manifest.json", manifest),
    writeJsonAtomic(snapshot.root, `events/${monthPath}.json`, allEvents),
    writeJsonAtomic(snapshot.root, "candidates/capabilities.json", [...new Map(candidates.map((item) => [item.id, item])).values()]),
    writeJsonAtomic(snapshot.root, "search-index.json", buildSearchIndex(merged)),
    writeJsonAtomic(snapshot.root, "meta.json", {
      ...snapshot.meta,
      lastCheckedAt: input.now,
      lastSuccessfulSyncAt: input.now,
      latestReportDate: latestReport.date,
      repositories: config.repositories.repositories.map((repo) => {
        if (!repo.enabled) return { slug: repo.slug, status: "ok" as const, checkedAt: input.now, message: "已停用，不再同步" };
        if (!enabledRepositorySlugs.has(repo.slug)) {
          return snapshot.meta.repositories.find((entry) => entry.slug === repo.slug)
            ?? { slug: repo.slug, status: "ok" as const, checkedAt: snapshot.meta.lastCheckedAt, message: "本次未选中" };
        }
        return { slug: repo.slug, status: rateLimitStop ? "degraded" as const : "ok" as const, checkedAt: input.now, message: rateLimitStop ? "上游接口限流安全停止" : "同步完成" };
      }),
      ai: { budgetDate: date, estimatedCostUsd: budget.estimatedCostUsd, itemsSummarized: budget.itemCount, inputTokens: budget.actualInputTokens, outputTokens: budget.actualOutputTokens, backlogCount, stopReason: summaryStopReason ?? (rateLimitStop ? "github-rate-limit" : backlogCount ? "summary-backlog" : null), lastSuccessfulCallAt: successfulSummariesThisRun ? input.now : snapshot.meta.ai.lastSuccessfulCallAt },
      sample: false,
    }),
  ]);
  await Promise.all(reportsToWrite.map((report) => writeJsonAtomic(
    snapshot.root,
    `reports/${report.date.replaceAll("-", "/")}.json`,
    report,
  )));
  await loadDataSnapshot(snapshot.root);
  return {
    collected: collected.length,
    published: completed.filter((item) => collectedNodeIds.has(item.nodeId)).length,
    backlogCount,
    rateLimitStop,
    summaryMode: summaryOperational ? "enabled" as const : "github-only" as const,
    summaryStopReason,
    reportsBackfilled: missingReports.length,
  };
}
