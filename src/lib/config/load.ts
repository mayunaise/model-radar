import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  capabilityConfigSchema,
  categoryConfigSchema,
  keywordConfigSchema,
  openAiConfigSchema,
  repositoryConfigSchema,
} from "../domain/schemas";

const defaultConfigRoot = resolve(import.meta.dirname, "../../../config");

async function readJson(configRoot: string, fileName: string): Promise<unknown> {
  return JSON.parse(await readFile(resolve(configRoot, fileName), "utf8"));
}

export async function loadProjectConfig(explicitRoot?: string) {
  const configRoot = resolve(explicitRoot ?? process.env.GLM_CONFIG_DIR ?? defaultConfigRoot);
  const [repositories, keywords, openai, capabilities, categories] = await Promise.all([
    readJson(configRoot, "repositories.json"),
    readJson(configRoot, "keywords.json"),
    readJson(configRoot, "openai.json"),
    readJson(configRoot, "capabilities.json"),
    readJson(configRoot, "categories.json"),
  ]);

  return {
    repositories: repositoryConfigSchema.parse(repositories),
    keywords: keywordConfigSchema.parse(keywords),
    openai: openAiConfigSchema.parse(openai),
    capabilities: capabilityConfigSchema.parse(capabilities),
    categories: categoryConfigSchema.parse(categories),
  };
}
