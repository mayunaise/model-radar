import { resolve } from "node:path";
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
const githubToken = process.env.GITHUB_TOKEN;
if (!githubToken) throw new Error("GITHUB_TOKEN is required for synchronization");

const result = await runSyncPipeline({
  dataDir,
  gateway: createGitHubGateway(githubToken),
  responsesClient: process.env.OPENAI_API_KEY ? createResponsesClient(process.env.OPENAI_API_KEY) : undefined,
  now: new Date().toISOString(),
  dryRun,
});
process.stdout.write(`${JSON.stringify(result)}\n`);
