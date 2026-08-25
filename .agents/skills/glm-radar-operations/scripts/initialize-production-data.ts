import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { repositoryConfigSchema } from "../../../../src/lib/domain/schemas";

type InitializeProductionDataInput = {
  projectRoot: string;
  outputDir: string;
  now: string;
};

function beijingDate(timestamp: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(timestamp));
}

async function writeJson(outputDir: string, relativePath: string, value: unknown) {
  const target = resolve(outputDir, relativePath);
  await mkdir(resolve(target, ".."), { recursive: true });
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function initializeProductionData(input: InitializeProductionDataInput) {
  const projectRoot = resolve(input.projectRoot);
  const outputDir = resolve(input.outputDir);
  const existingEntries = await readdir(outputDir).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  if (existingEntries.length > 0) throw new Error("Output directory must be empty");
  const repositories = repositoryConfigSchema.parse(
    JSON.parse(await readFile(resolve(projectRoot, "config/repositories.json"), "utf8")),
  ).repositories;

  await Promise.all([
    mkdir(resolve(outputDir, "items"), { recursive: true }),
    mkdir(resolve(outputDir, "reports"), { recursive: true }),
    mkdir(resolve(outputDir, "events"), { recursive: true }),
    mkdir(resolve(outputDir, "candidates"), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(resolve(outputDir, "items/.gitkeep"), "", "utf8"),
    writeFile(resolve(outputDir, "reports/.gitkeep"), "", "utf8"),
    writeFile(resolve(outputDir, "events/.gitkeep"), "", "utf8"),
    writeJson(outputDir, "meta.json", {
      schemaVersion: 1,
      lastCheckedAt: input.now,
      lastSuccessfulSyncAt: input.now,
      lastPublishedAt: input.now,
      latestReportDate: beijingDate(input.now),
      repositories: repositories.map((repository) => ({
        slug: repository.slug,
        status: "degraded",
        checkedAt: input.now,
        message: "等待首次真实同步",
      })),
      ai: {
        budgetDate: beijingDate(input.now),
        estimatedCostUsd: 0,
        itemsSummarized: 0,
        inputTokens: 0,
        outputTokens: 0,
        backlogCount: 0,
        stopReason: null,
        lastSuccessfulCallAt: null,
      },
      sample: false,
    }),
    writeJson(outputDir, "manifest.json", {
      schemaVersion: 1,
      items: {},
      cursors: {},
      backfill: Object.fromEntries(repositories.map((repository) => [
        repository.slug,
        { status: "pending", nextPage: 1, historyStartAt: repository.historyStartAt },
      ])),
      searchBackfill: Object.fromEntries(repositories.map((repository) => [
        repository.slug,
        { status: "pending", type: "issue", nextPage: 1, queryVersion: "glm-title-v1" },
      ])),
    }),
    writeJson(outputDir, "schemas-version.json", {
      schemaVersion: 1,
      generatedBy: "glm-radar-operations",
    }),
    writeJson(outputDir, "candidates/capabilities.json", []),
    writeJson(outputDir, "search-index.json", []),
  ]);
}

function argumentValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const outputDir = argumentValue("--output");
  if (!outputDir) throw new Error("--output is required");
  const now = argumentValue("--now") ?? new Date().toISOString();
  if (Number.isNaN(Date.parse(now))) throw new Error("--now must be an ISO timestamp");
  await initializeProductionData({
    projectRoot: argumentValue("--project-root") ?? process.cwd(),
    outputDir,
    now,
  });
  process.stdout.write(`Initialized clean production data at ${resolve(outputDir)}\n`);
}
