import { resolve } from "node:path";
import { loadProjectConfig } from "../../src/lib/config/load";
import { createGitCodeGateway } from "./gitcode";
import { createGitHubGateway } from "./github";
import { createResponsesClient } from "./openai";
import { runSyncPipeline } from "./pipeline";

const argumentsList = process.argv.slice(2);
const valueAfter = (flag: string) => {
  const index = argumentsList.indexOf(flag);
  return index >= 0 ? argumentsList[index + 1] : undefined;
};
const dataDir = resolve(valueAfter("--data-dir") ?? process.env.GLM_DATA_DIR ?? "fixtures/bootstrap-data");
const dryRun = argumentsList.includes("--dry-run");
const fullSummaryBackfill = argumentsList.includes("--full-summary-backfill");
const fullSourceBackfill = argumentsList.includes("--full-source-backfill");
const repositorySlug = valueAfter("--repository");
if (argumentsList.includes("--repository") && !repositorySlug) throw new Error("--repository requires an owner/repository value");
if (fullSourceBackfill && !repositorySlug) throw new Error("--full-source-backfill requires --repository");
const aiSummaryConcurrencyValue = valueAfter("--ai-concurrency");
const aiSummaryConcurrency = aiSummaryConcurrencyValue === undefined ? undefined : Number(aiSummaryConcurrencyValue);
const maxAiItemsValue = valueAfter("--max-ai-items");
const DEFAULT_MAX_AI_ITEMS_PER_RUN = 20;
const maxAiItemsThisRun = Number(maxAiItemsValue ?? (fullSummaryBackfill
  ? Number.MAX_SAFE_INTEGER
  : process.env.GLM_MAX_AI_ITEMS_PER_RUN ?? DEFAULT_MAX_AI_ITEMS_PER_RUN));
if (!Number.isInteger(maxAiItemsThisRun) || maxAiItemsThisRun < 1) {
  throw new Error("--max-ai-items must be a positive integer");
}
if (aiSummaryConcurrency !== undefined && (!Number.isInteger(aiSummaryConcurrency) || aiSummaryConcurrency < 1 || aiSummaryConcurrency > 3)) {
  throw new Error("--ai-concurrency must be an integer between 1 and 3");
}
const projectConfig = await loadProjectConfig();
const selectedRepositories = projectConfig.repositories.repositories
  .filter((repository) => repository.enabled && (!repositorySlug || repository.slug === repositorySlug));
if (repositorySlug && selectedRepositories.length !== 1) throw new Error(`Repository is not enabled or configured: ${repositorySlug}`);
const enabledProviders = new Set(selectedRepositories
  .map((repository) => repository.source?.provider ?? "github"));
const githubToken = process.env.GITHUB_TOKEN?.trim();
const gitCodeToken = process.env.GITCODE_TOKEN?.trim();
if (enabledProviders.has("github") && !githubToken) throw new Error("GITHUB_TOKEN is required for enabled GitHub repositories");
if (fullSummaryBackfill && !process.env.OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY is required for --full-summary-backfill");
}
const githubGateway = githubToken ? createGitHubGateway(githubToken) : undefined;
const gitCodeGateway = enabledProviders.has("gitcode") ? createGitCodeGateway(gitCodeToken) : undefined;

const result = await runSyncPipeline({
  dataDir,
  gateway: githubGateway,
  sourceGateways: {
    ...(githubGateway ? { github: githubGateway } : {}),
    ...(gitCodeGateway ? { gitcode: gitCodeGateway } : {}),
  },
  projectConfig,
  responsesClient: process.env.OPENAI_API_KEY ? createResponsesClient(process.env.OPENAI_API_KEY) : undefined,
  now: new Date().toISOString(),
  dryRun,
  maxAiItemsThisRun,
  fullSummaryBackfill,
  fullSourceBackfill,
  repositorySlug,
  aiSummaryConcurrency,
  onProgress(message) {
    process.stderr.write(`[sync] ${message}\n`);
  },
});
process.stdout.write(`${JSON.stringify(result)}\n`);
