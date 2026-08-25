import { z } from "zod";

const isoDateTime = z.iso.datetime({ offset: true });
const isoDate = z.iso.date();
const repositorySlug = z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
const upstreamUrl = z
  .url()
  .refine(
    (value) => ["github.com", "gitcode.com"].includes(new URL(value).hostname),
    "Expected a supported upstream URL",
  );

export const activityTypeSchema = z.enum(["issue", "pr"]);
export const activityCategorySchema = z.enum([
  "NEW_SUPPORT",
  "BUG",
  "FIX",
  "PERFORMANCE",
  "DOCS",
  "COMPATIBILITY",
  "OTHER",
]);

export const categoryConfigSchema = z
  .object({
    schemaVersion: z.literal(1),
    categories: z.array(
      z.object({
        code: activityCategorySchema,
        appliesTo: z.array(activityTypeSchema).min(1).max(2),
        labels: z
          .object({
            issue: z.string().min(1).optional(),
            pr: z.string().min(1).optional(),
          })
          .strict(),
        order: z.number().int().nonnegative(),
      }),
    ),
  })
  .superRefine(({ categories }, context) => {
    const seen = new Set<string>();
    for (const [index, category] of categories.entries()) {
      if (seen.has(category.code)) {
        context.addIssue({ code: "custom", message: `Duplicate category code: ${category.code}`, path: ["categories", index, "code"] });
      }
      seen.add(category.code);
      for (const type of activityTypeSchema.options) {
        const applies = category.appliesTo.includes(type);
        const hasLabel = Boolean(category.labels[type]);
        if (applies !== hasLabel) {
          context.addIssue({ code: "custom", message: `Category ${category.code} must define labels exactly for its applicable types`, path: ["categories", index, "labels", type] });
        }
      }
    }
    for (const code of activityCategorySchema.options) {
      if (!seen.has(code)) {
        context.addIssue({ code: "custom", message: `Missing category code: ${code}`, path: ["categories"] });
      }
    }
  });

export const repositorySchema = z.object({
  slug: repositorySlug,
  source: z.object({
    provider: z.enum(["github", "gitcode"]),
    slug: repositorySlug,
  }).optional(),
  dataKey: z.string().regex(/^[a-z0-9-]+$/),
  historyStartAt: isoDateTime,
  backfillPageLimit: z.number().int().positive().max(2),
  canonicalSlug: repositorySlug.optional(),
  framework: z.string().min(1),
  enabled: z.boolean(),
  defaultBranch: z.string().min(1),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  keywords: z.array(z.string().min(1)),
});

export const repositoryConfigSchema = z
  .object({
    schemaVersion: z.literal(1),
    repositories: z.array(repositorySchema).min(1),
  })
  .superRefine(({ repositories }, context) => {
    const slugs = new Set<string>();
    const dataKeys = new Set<string>();
    for (const repository of repositories) {
      if (slugs.has(repository.slug)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate repository slug: ${repository.slug}`,
          path: ["repositories"],
        });
      }
      slugs.add(repository.slug);
      if (dataKeys.has(repository.dataKey)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate repository data key: ${repository.dataKey}`,
          path: ["repositories"],
        });
      }
      dataKeys.add(repository.dataKey);
    }
  });

export const keywordConfigSchema = z.object({
  schemaVersion: z.literal(1),
  global: z.array(z.string().min(1)).min(1),
  includePatterns: z.array(z.string().min(1)),
  excludeTerms: z.array(z.string().min(1)),
  scenarioTerms: z.object({
    training: z.array(z.string().min(1)),
    inference: z.array(z.string().min(1)),
    rl: z.array(z.string().min(1)),
  }),
});

const positiveInteger = z.number().int().positive();

export const openAiConfigSchema = z.object({
  model: z.literal("gpt-5.6-luna"),
  reasoningEffort: z.literal("none"),
  dailyItemLimit: positiveInteger.max(120),
  dailyBudgetUsd: z.number().positive().max(0.35),
  safetyMarginPercent: z.number().min(0).max(50),
  itemMaxInputTokens: positiveInteger.max(8000),
  itemMaxOutputTokens: positiveInteger.max(4096),
  reportMaxInputTokens: positiveInteger.max(12000),
  reportMaxOutputTokens: positiveInteger.max(1200),
  maxRetries: z.number().int().min(0).max(1),
  rpm: positiveInteger.max(30),
  tpm: positiveInteger.max(150000),
  pricingUsdPerMillionTokens: z.object({
    input: z.number().positive(),
    output: z.number().positive(),
  }),
});

export const summarySchema = z.object({
  headlineZh: z.string().min(1).max(80),
  summaryZh: z.string().min(1).max(2000),
  models: z.array(z.string().min(1)),
  hardware: z.array(z.enum(["GPU", "NPU", "CPU", "UNKNOWN"])),
  scenarios: z.array(
    z.enum(["TRAINING", "INFERENCE", "RL", "EVALUATION", "OTHER"]),
  ),
  category: activityCategorySchema,
  severity: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"]),
  impactScopeZh: z.string().max(500),
  attention: z.enum(["IMMEDIATE", "WATCH", "ROUTINE"]),
  capabilityCandidate: z.boolean(),
  evidence: z.array(z.string().max(300)),
  truncated: z.boolean(),
  model: z.literal("gpt-5.6-luna"),
  promptVersion: z.string().min(1),
  generatedAt: isoDateTime,
});

export const activityItemSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  nodeId: z.string().min(1),
  repository: repositorySlug,
  number: positiveInteger,
  type: activityTypeSchema,
  title: z.string().min(1).max(500),
  bodyExcerpt: z.string().max(2000),
  author: z.string().min(1).max(100),
  state: z.enum(["open", "closed", "merged"]),
  labels: z.array(z.string().max(100)),
  url: upstreamUrl,
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
  mergedAt: isoDateTime.nullable().optional(),
  firstSeenAt: isoDateTime,
  contentHash: z.string().min(1),
  category: activityCategorySchema.optional(),
  categorySource: z.enum(["rules", "ai"]).optional(),
  summary: summarySchema.nullable(),
});

export const dailyReportSchema = z.object({
  date: isoDate,
  intro: z.string().min(1).max(2000),
  groups: z.array(
    z.object({
      key: z.string().regex(/^[a-z0-9-]+$/),
      title: z.string().min(1),
      itemIds: z.array(z.string().min(1)),
    }),
  ),
  completeness: z.enum(["complete", "partial", "github-only"]),
  model: z.literal("gpt-5.6-luna"),
  promptVersion: z.string().min(1),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
  sample: z.boolean().optional(),
});

export const qualityAuditItemSchema = z.object({
  id: z.string().min(1),
  repository: repositorySlug,
  number: positiveInteger,
  type: activityTypeSchema,
  category: activityCategorySchema,
  categoryValid: z.boolean(),
  ruleCategory: activityCategorySchema.optional(),
  classificationConsistent: z.boolean().optional(),
  title: z.string().min(1).max(500),
  bodyExcerpt: z.string().max(2000),
  labels: z.array(z.string().max(100)),
  filterDisposition: z.enum(["eligible", "review", "excluded"]),
  relevanceScore: z.number().nonnegative(),
  matchedTerms: z.array(z.string()),
  scenarios: z.array(z.enum(["TRAINING", "INFERENCE", "RL"])),
  sourceMatch: z.boolean().nullable(),
  sourceMismatchFields: z.array(z.enum(["title", "state", "updatedAt", "url"])),
  warnings: z.array(z.string().max(1000)),
});

export const qualityAuditReportSchema = z.object({
  schemaVersion: z.literal(1),
  scope: z.enum(["daily-incremental", "stratified-sample"]).default("stratified-sample"),
  date: isoDate,
  generatedAt: isoDateTime,
  seed: z.string().min(1),
  samplePerStratum: positiveInteger,
  summary: z.object({
    population: z.number().int().nonnegative(),
    sampled: z.number().int().nonnegative(),
    strata: z.number().int().nonnegative(),
    structuralFailures: z.number().int().nonnegative(),
    sourceMismatches: z.number().int().nonnegative(),
    sourceChecksSkipped: z.number().int().nonnegative(),
    classificationDrifts: z.number().int().nonnegative().default(0),
    relevanceFailures: z.number().int().nonnegative().default(0),
    reviewWarnings: z.number().int().nonnegative(),
  }),
  items: z.array(qualityAuditItemSchema),
});

export const capabilityEntrySchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  framework: z.string().min(1),
  model: z.string().min(1),
  hardware: z.enum(["NPU", "GPU"]),
  scenario: z.enum(["TRAINING", "INFERENCE", "RL"]),
  capability: z.string().min(1),
  status: z.enum([
    "supported",
    "partial",
    "experimental",
    "planned",
    "unsupported",
    "unknown",
  ]),
  minimumVersion: z.string().min(1).nullable(),
  limitations: z.string().max(1000),
  verifiedAt: isoDate,
  evidence: z.array(upstreamUrl).min(1),
});

export const capabilityConfigSchema = z.object({
  schemaVersion: z.literal(1),
  entries: z.array(capabilityEntrySchema),
});

export const manifestSchema = z.object({
  schemaVersion: z.literal(1),
  items: z.record(
    z.string(),
    z.object({
      shard: z.string().regex(/^items\/[a-z0-9-]+\/\d{4}\/\d{2}\.json$/),
      contentHash: z.string().min(1),
      summaryHash: z.string().min(1).nullable(),
      updatedAt: isoDateTime,
    }),
  ),
  cursors: z.record(repositorySlug, isoDateTime),
  backfill: z.record(
    repositorySlug,
    z.object({
      status: z.enum(["pending", "running", "complete"]),
      nextPage: positiveInteger,
      historyStartAt: isoDateTime,
    }),
  ),
  searchBackfill: z.record(
    repositorySlug,
    z.object({
      status: z.enum(["pending", "running", "complete"]),
      type: activityTypeSchema,
      nextPage: positiveInteger,
      queryVersion: z.literal("glm-title-v1"),
    }),
  ).default({}),
  sources: z.record(
    repositorySlug,
    z.object({
      provider: z.enum(["github", "gitcode"]),
      slug: repositorySlug,
    }),
  ).default({}),
});

export const searchDocumentSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  summary: z.string(),
  repository: repositorySlug,
  type: activityTypeSchema,
  state: z.enum(["open", "closed", "merged"]),
  category: summarySchema.shape.category,
  updatedAt: isoDateTime,
  url: upstreamUrl,
  models: z.array(z.string()),
});

export const searchIndexSchema = z.array(searchDocumentSchema);

export const repositoryHealthSchema = z.object({
  slug: repositorySlug,
  status: z.enum(["ok", "degraded", "error"]),
  checkedAt: isoDateTime,
  message: z.string().max(500),
});

export const metaSchema = z.object({
  schemaVersion: z.literal(1),
  lastCheckedAt: isoDateTime,
  lastSuccessfulSyncAt: isoDateTime,
  lastPublishedAt: isoDateTime,
  latestReportDate: isoDate,
  repositories: z.array(repositoryHealthSchema),
  ai: z.object({
    budgetDate: isoDate.optional(),
    estimatedCostUsd: z.number().nonnegative().optional(),
    itemsSummarized: z.number().int().nonnegative(),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    backlogCount: z.number().int().nonnegative(),
    stopReason: z.string().nullable(),
    lastSuccessfulCallAt: isoDateTime.nullable(),
  }),
  sample: z.boolean().optional(),
});

export const eventSchema = z.object({
  id: z.string().min(1),
  itemId: z.string().min(1),
  type: z.enum(["created", "state", "labels", "content", "summary"]),
  oldValue: z.string().nullable(),
  newValue: z.string().nullable(),
  occurredAt: isoDateTime,
});

export const eventListSchema = z.array(eventSchema);

export const capabilityCandidateSchema = z.object({
  id: z.string().min(1),
  itemId: z.string().min(1),
  reasonZh: z.string().min(1).max(1000),
  suggestedAction: z.enum(["review", "add", "update", "remove"]),
  generatedAt: isoDateTime,
});

export const capabilityCandidateListSchema = z.array(capabilityCandidateSchema);

export const schemaVersionSchema = z.object({
  schemaVersion: z.literal(1),
  generatedBy: z.string().min(1),
});
