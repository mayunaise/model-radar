import { z } from "zod";

const isoDateTime = z.iso.datetime({ offset: true });
const isoDate = z.iso.date();
const repositorySlug = z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
const githubUrl = z
  .url()
  .refine((value) => new URL(value).hostname === "github.com", "Expected a GitHub URL");

export const repositorySchema = z.object({
  slug: repositorySlug,
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
    for (const repository of repositories) {
      if (slugs.has(repository.slug)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate repository slug: ${repository.slug}`,
          path: ["repositories"],
        });
      }
      slugs.add(repository.slug);
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
  itemMaxOutputTokens: positiveInteger.max(800),
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
  category: z.enum([
    "NEW_SUPPORT",
    "BUG",
    "FIX",
    "PERFORMANCE",
    "DOCS",
    "COMPATIBILITY",
    "OTHER",
  ]),
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
  type: z.enum(["issue", "pr"]),
  title: z.string().min(1).max(500),
  bodyExcerpt: z.string().max(2000),
  author: z.string().min(1).max(100),
  state: z.enum(["open", "closed", "merged"]),
  labels: z.array(z.string().max(100)),
  url: githubUrl,
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
  mergedAt: isoDateTime.nullable().optional(),
  firstSeenAt: isoDateTime,
  contentHash: z.string().min(1),
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
  evidence: z.array(githubUrl).min(1),
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
      shard: z.string().regex(/^items\/\d{4}\/\d{2}\.json$/),
      contentHash: z.string().min(1),
      summaryHash: z.string().min(1).nullable(),
      updatedAt: isoDateTime,
    }),
  ),
  cursors: z.record(repositorySlug, isoDateTime),
});

export const searchDocumentSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  summary: z.string(),
  repository: repositorySlug,
  type: z.enum(["issue", "pr"]),
  state: z.enum(["open", "closed", "merged"]),
  category: summarySchema.shape.category,
  updatedAt: isoDateTime,
  url: githubUrl,
  models: z.array(z.string()),
});

export const searchIndexSchema = z.array(searchDocumentSchema);
