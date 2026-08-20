import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { z } from "zod";
import { loadProjectConfig } from "../config/load";
import {
  activityItemSchema,
  capabilityCandidateListSchema,
  dailyReportSchema,
  eventListSchema,
  manifestSchema,
  metaSchema,
  schemaVersionSchema,
  searchIndexSchema,
} from "../domain/schemas";
import { dataPath } from "./paths";

const defaultDataRoot = resolve(import.meta.dirname, "../../../fixtures/bootstrap-data");

export function resolveDataRoot(explicitRoot?: string): string {
  return resolve(explicitRoot ?? process.env.GLM_DATA_DIR ?? defaultDataRoot);
}

export function resolveDataPath(root: string, path: string): string {
  return dataPath(root, path);
}

async function readJson<T extends z.ZodType>(
  root: string,
  path: string,
  schema: T,
): Promise<z.infer<T>> {
  const value = JSON.parse(await readFile(resolveDataPath(root, path), "utf8"));
  return schema.parse(value);
}

async function listJsonFiles(root: string, directory: string): Promise<string[]> {
  const absoluteDirectory = resolveDataPath(root, directory);
  const entries = await readdir(absoluteDirectory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const child = `${directory}/${entry.name}`;
      if (entry.isDirectory()) return listJsonFiles(root, child);
      return entry.isFile() && entry.name.endsWith(".json") ? [child] : [];
    }),
  );
  return files.flat().sort();
}

export async function loadDataSnapshot(explicitRoot?: string) {
  const root = resolveDataRoot(explicitRoot);
  const [meta, manifest, schemasVersion, itemFiles, reportFiles, eventFiles, candidates, searchIndex, projectConfig] =
    await Promise.all([
      readJson(root, "meta.json", metaSchema),
      readJson(root, "manifest.json", manifestSchema),
      readJson(root, "schemas-version.json", schemaVersionSchema),
      listJsonFiles(root, "items"),
      listJsonFiles(root, "reports"),
      listJsonFiles(root, "events"),
      readJson(root, "candidates/capabilities.json", capabilityCandidateListSchema),
      readJson(root, "search-index.json", searchIndexSchema),
      loadProjectConfig(),
    ]);

  const items = (
    await Promise.all(
      itemFiles.map((file) => readJson(root, file, activityItemSchema.array())),
    )
  ).flat();
  const reports = await Promise.all(
    reportFiles.map((file) => readJson(root, file, dailyReportSchema)),
  );
  const events = (
    await Promise.all(eventFiles.map((file) => readJson(root, file, eventListSchema)))
  ).flat();

  return {
    root,
    meta,
    manifest,
    schemasVersion,
    items,
    reports: reports.sort((a, b) => b.date.localeCompare(a.date)),
    events,
    candidates,
    searchIndex,
    capabilities: projectConfig.capabilities.entries,
  };
}
