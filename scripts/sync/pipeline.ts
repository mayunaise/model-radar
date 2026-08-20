import { createHash } from "node:crypto";
import { loadProjectConfig } from "../../src/lib/config/load";
import { loadDataSnapshot } from "../../src/lib/data/load";
import type { ActivityItem, CapabilityCandidate, DataEvent, DailyReport, Manifest } from "../../src/lib/domain/types";
import { buildSearchIndex } from "../build-search-index";
import { BudgetLedger, estimateTokens } from "./budget";
import { collectRepository } from "./github";
import type { ResponsesClient } from "./openai";
import { summarizeCandidate } from "./openai";
import { candidateInput } from "./prompts";
import { scoreRelevance } from "./relevance";
import { itemShard, mergeItems, writeItemShards, writeJsonAtomic } from "./store";
import type { GitHubGateway } from "./types";

type PipelineInput = {
  dataDir: string;
  gateway: GitHubGateway;
  responsesClient?: ResponsesClient;
  now: string;
  dryRun?: boolean;
};

function beijingDate(timestamp: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(timestamp));
}

function hash(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function makeReport(date: string, items: ActivityItem[], now: string): DailyReport {
  const attention = items.filter((item) => item.summary?.attention !== "ROUTINE").map((item) => item.id);
  const routine = items.filter((item) => !attention.includes(item.id)).map((item) => item.id);
  return {
    date,
    intro: `今日收录 ${items.length} 条与 GLM 相关的上游动态，其中 ${attention.length} 条值得优先关注。`,
    groups: [
      { key: "attention", title: "值得关注", itemIds: attention },
      { key: "routine", title: "常规动态", itemIds: routine },
    ].filter((group) => group.itemIds.length > 0),
    completeness: items.some((item) => !item.summary) ? "github-only" : "complete",
    model: "gpt-5.6-luna",
    promptVersion: "deterministic-report-v1",
    createdAt: now,
    updatedAt: now,
  };
}

export async function runSyncPipeline(input: PipelineInput) {
  const [snapshot, config] = await Promise.all([
    loadDataSnapshot(input.dataDir),
    loadProjectConfig(),
  ]);
  const ledger = new BudgetLedger(config.openai);
  const collected = [];
  let rateLimitStop = false;

  for (const repository of config.repositories.repositories.filter((repo) => repo.enabled)) {
    const since = snapshot.manifest.cursors[repository.slug] ?? snapshot.meta.lastSuccessfulSyncAt;
    const result = await collectRepository(input.gateway, repository, since, input.now);
    collected.push(...result.items);
    if (result.rateLimit.remaining < 50) {
      rateLimitStop = true;
      break;
    }
  }

  const completed: ActivityItem[] = [];
  const candidates: CapabilityCandidate[] = [...snapshot.candidates];
  let backlogCount = 0;
  for (const candidate of collected) {
    const relevance = scoreRelevance(candidate, config.keywords);
    if (relevance.disposition === "excluded") continue;
    let summary = snapshot.items.find((item) => item.nodeId === candidate.nodeId && item.contentHash === candidate.contentHash)?.summary ?? null;
    if (relevance.disposition === "eligible" && !summary && input.responsesClient) {
      const inputTokens = estimateTokens(candidateInput(candidate));
      const reservation = ledger.reserveItem(inputTokens, config.openai.itemMaxOutputTokens);
      if (reservation.allowed) {
        try {
          const result = await summarizeCandidate(input.responsesClient, candidate, config.openai, input.now);
          summary = result.summary;
          ledger.recordActualUsage(result.usage.inputTokens, result.usage.outputTokens);
        } catch {
          backlogCount += 1;
        }
      } else backlogCount += 1;
    } else if (relevance.disposition === "eligible" && !summary) backlogCount += 1;

    const item: ActivityItem = { ...candidate, summary };
    completed.push(item);
    if (summary?.capabilityCandidate || relevance.disposition === "review") {
      candidates.push({ id: `${candidate.nodeId}-${candidate.contentHash}`, itemId: candidate.id, reasonZh: "检测到可能影响能力矩阵的上游变更，需维护者核实证据。", suggestedAction: "review", generatedAt: input.now });
    }
  }

  const merged = mergeItems(snapshot.items, completed);
  if (input.dryRun) return { collected: collected.length, published: completed.length, backlogCount, rateLimitStop };

  const oldByNode = new Map(snapshot.items.map((item) => [item.nodeId, item]));
  const newEvents: DataEvent[] = completed
    .filter((item) => oldByNode.get(item.nodeId)?.state !== item.state)
    .map((item) => ({ id: `${item.nodeId}-state-${hash(item.state)}`, itemId: item.id, type: "state", oldValue: oldByNode.get(item.nodeId)?.state ?? null, newValue: item.state, occurredAt: item.updatedAt }));
  const allEvents = [...snapshot.events, ...newEvents];
  const date = beijingDate(input.now);
  const latestReport = completed.length ? makeReport(date, completed, input.now) : undefined;
  const budget = ledger.snapshot();
  const manifest: Manifest = {
    schemaVersion: 1,
    items: Object.fromEntries(merged.map((item) => [item.nodeId, { shard: itemShard(item), contentHash: item.contentHash, summaryHash: item.summary ? hash(item.summary) : null, updatedAt: item.updatedAt }])),
    cursors: Object.fromEntries(config.repositories.repositories.map((repo) => [repo.slug, input.now])),
  };
  const monthPath = input.now.slice(0, 7).replace("-", "/");

  await writeItemShards(snapshot.root, merged);
  await Promise.all([
    writeJsonAtomic(snapshot.root, "manifest.json", manifest),
    writeJsonAtomic(snapshot.root, `events/${monthPath}.json`, allEvents),
    writeJsonAtomic(snapshot.root, "candidates/capabilities.json", [...new Map(candidates.map((item) => [item.id, item])).values()]),
    writeJsonAtomic(snapshot.root, "search-index.json", buildSearchIndex(merged)),
    writeJsonAtomic(snapshot.root, "meta.json", {
      ...snapshot.meta,
      lastCheckedAt: input.now,
      lastSuccessfulSyncAt: input.now,
      latestReportDate: latestReport?.date ?? snapshot.meta.latestReportDate,
      repositories: config.repositories.repositories.map((repo) => ({ slug: repo.slug, status: rateLimitStop ? "degraded" : "ok", checkedAt: input.now, message: rateLimitStop ? "GitHub rate limit safety stop" : "同步完成" })),
      ai: { itemsSummarized: budget.itemCount, inputTokens: budget.actualInputTokens, outputTokens: budget.actualOutputTokens, backlogCount, stopReason: rateLimitStop ? "github-rate-limit" : backlogCount ? "summary-backlog" : null, lastSuccessfulCallAt: budget.itemCount ? input.now : snapshot.meta.ai.lastSuccessfulCallAt },
      sample: false,
    }),
  ]);
  if (latestReport) await writeJsonAtomic(snapshot.root, `reports/${date.replaceAll("-", "/")}.json`, latestReport);
  await loadDataSnapshot(snapshot.root);
  return { collected: collected.length, published: completed.length, backlogCount, rateLimitStop };
}
