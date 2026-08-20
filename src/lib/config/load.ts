import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  capabilityConfigSchema,
  keywordConfigSchema,
  openAiConfigSchema,
  repositoryConfigSchema,
} from "../domain/schemas";

const projectRoot = resolve(import.meta.dirname, "../../..");

async function readJson(fileName: string): Promise<unknown> {
  return JSON.parse(await readFile(resolve(projectRoot, "config", fileName), "utf8"));
}

export async function loadProjectConfig() {
  const [repositories, keywords, openai, capabilities] = await Promise.all([
    readJson("repositories.json"),
    readJson("keywords.json"),
    readJson("openai.json"),
    readJson("capabilities.json"),
  ]);

  return {
    repositories: repositoryConfigSchema.parse(repositories),
    keywords: keywordConfigSchema.parse(keywords),
    openai: openAiConfigSchema.parse(openai),
    capabilities: capabilityConfigSchema.parse(capabilities),
  };
}
