import { createHash } from "node:crypto";
import type { ActivityItem, KeywordConfig, Summary } from "../../src/lib/domain/types";
import { categoryForItem, classifyActivityItem } from "../../src/lib/domain/classification";
import { scoreRelevance } from "../sync/relevance";

type Category = Summary["category"];

type CategoryConfigLike = {
  categories: ReadonlyArray<{
    code: Category;
    appliesTo: ReadonlyArray<ActivityItem["type"]>;
  }>;
};

export type AuditSourceItem = Pick<ActivityItem, "title" | "state" | "updatedAt" | "url">;

export interface AuditSource {
  get(item: ActivityItem): Promise<AuditSourceItem>;
}

const AUDIT_SOURCE_CONCURRENCY = 4;

async function mapWithConcurrency<T, R>(values: T[], concurrency: number, task: (value: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const worker = async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= values.length) return;
      results[index] = await task(values[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker));
  return results;
}

function sourceFieldMatches(
  field: keyof AuditSourceItem,
  source: AuditSourceItem,
  item: ActivityItem,
): boolean {
  if (field === "updatedAt") return Date.parse(source.updatedAt) === Date.parse(item.updatedAt);
  return source[field] === item[field];
}

export type QualityAuditItem = {
  id: string;
  repository: string;
  number: number;
  type: ActivityItem["type"];
  category: Category;
  categoryValid: boolean;
  ruleCategory: Category;
  classificationConsistent: boolean;
  title: string;
  bodyExcerpt: string;
  labels: string[];
  filterDisposition: "eligible" | "review" | "excluded";
  relevanceScore: number;
  matchedTerms: string[];
  scenarios: Array<"TRAINING" | "INFERENCE" | "RL">;
  sourceMatch: boolean | null;
  sourceMismatchFields: string[];
  warnings: string[];
};

function rank(seed: string, item: ActivityItem): string {
  return createHash("sha256").update(`${seed}:${item.nodeId}`).digest("hex");
}

export function selectStratifiedSample(
  items: ActivityItem[],
  seed: string,
  perStratum = 2,
): ActivityItem[] {
  if (!Number.isInteger(perStratum) || perStratum < 1) {
    throw new Error("perStratum must be a positive integer");
  }
  const strata = new Map<string, ActivityItem[]>();
  for (const item of items) {
    const key = `${item.type}:${categoryForItem(item)}`;
    strata.set(key, [...(strata.get(key) ?? []), item]);
  }
  return [...strata.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([, stratum]) => stratum
      .sort((left, right) => rank(seed, left).localeCompare(rank(seed, right)) || left.id.localeCompare(right.id))
      .slice(0, perStratum));
}

function categoryAllowed(config: CategoryConfigLike, item: ActivityItem, category: Category): boolean {
  return config.categories.some((definition) => (
    definition.code === category && definition.appliesTo.includes(item.type)
  ));
}

export async function auditSample(input: {
  items: ActivityItem[];
  date: string;
  categories: CategoryConfigLike;
  keywords: KeywordConfig;
  source?: AuditSource;
  samplePerStratum?: number;
  auditAll?: boolean;
  generatedAt?: string;
}) {
  const samplePerStratum = input.samplePerStratum ?? 2;
  const sampled = input.auditAll
    ? [...input.items].sort((left, right) => left.id.localeCompare(right.id))
    : selectStratifiedSample(input.items, input.date, samplePerStratum);

  const auditedItems = await mapWithConcurrency(sampled, AUDIT_SOURCE_CONCURRENCY, async (item): Promise<QualityAuditItem> => {
    const category = categoryForItem(item);
    const ruleCategory = classifyActivityItem(item);
    const classificationConsistent = item.categorySource !== "rules" || category === ruleCategory;
    const categoryValid = categoryAllowed(input.categories, item, category);
    const relevance = scoreRelevance(item, input.keywords);
    const warnings: string[] = [];
    if (!categoryValid) warnings.push("category-not-allowed-for-type");
    if (!classificationConsistent) warnings.push(`classification-drift:${category}->${ruleCategory}`);
    if (relevance.disposition !== "eligible") warnings.push(`relevance-${relevance.disposition}`);

    let sourceMatch: boolean | null = null;
    let sourceMismatchFields: string[] = [];
    if (input.source) {
      try {
        const source = await input.source.get(item);
        sourceMismatchFields = (["title", "state", "updatedAt", "url"] as const)
          .filter((field) => !sourceFieldMatches(field, source, item));
        sourceMatch = sourceMismatchFields.length === 0;
        if (!sourceMatch) warnings.push(`source-mismatch:${sourceMismatchFields.join(",")}`);
      } catch (error) {
        warnings.push(`source-check-failed:${error instanceof Error ? error.message : "unknown"}`);
      }
    } else {
      warnings.push("source-check-skipped");
    }

    return {
      id: item.id,
      repository: item.repository,
      number: item.number,
      type: item.type,
      category,
      categoryValid,
      ruleCategory,
      classificationConsistent,
      title: item.title,
      bodyExcerpt: item.bodyExcerpt,
      labels: item.labels,
      filterDisposition: relevance.disposition,
      relevanceScore: relevance.score,
      matchedTerms: relevance.matchedTerms,
      scenarios: relevance.scenarios,
      sourceMatch,
      sourceMismatchFields,
      warnings,
    };
  });

  return {
    schemaVersion: 1 as const,
    scope: input.auditAll ? "daily-incremental" as const : "stratified-sample" as const,
    date: input.date,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    seed: input.date,
    samplePerStratum,
    summary: {
      population: input.items.length,
      sampled: auditedItems.length,
      strata: new Set(auditedItems.map((item) => `${item.type}:${item.category}`)).size,
      structuralFailures: auditedItems.filter((item) => !item.categoryValid).length,
      sourceMismatches: auditedItems.filter((item) => item.sourceMatch === false).length,
      sourceChecksSkipped: auditedItems.filter((item) => item.sourceMatch === null).length,
      classificationDrifts: auditedItems.filter((item) => !item.classificationConsistent).length,
      relevanceFailures: auditedItems.filter((item) => item.filterDisposition === "excluded").length,
      reviewWarnings: auditedItems.filter((item) => (
        !item.classificationConsistent || item.filterDisposition !== "eligible" || item.sourceMatch === false || item.warnings.some((warning) => warning.startsWith("source-check-failed:"))
      )).length,
    },
    items: auditedItems,
  };
}
