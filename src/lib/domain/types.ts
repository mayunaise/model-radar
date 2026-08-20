import type { z } from "zod";
import type {
  activityItemSchema,
  capabilityConfigSchema,
  capabilityEntrySchema,
  dailyReportSchema,
  keywordConfigSchema,
  manifestSchema,
  openAiConfigSchema,
  repositoryConfigSchema,
  searchDocumentSchema,
  summarySchema,
} from "./schemas";

export type ActivityItem = z.infer<typeof activityItemSchema>;
export type CapabilityConfig = z.infer<typeof capabilityConfigSchema>;
export type CapabilityEntry = z.infer<typeof capabilityEntrySchema>;
export type DailyReport = z.infer<typeof dailyReportSchema>;
export type KeywordConfig = z.infer<typeof keywordConfigSchema>;
export type Manifest = z.infer<typeof manifestSchema>;
export type OpenAiConfig = z.infer<typeof openAiConfigSchema>;
export type RepositoryConfig = z.infer<typeof repositoryConfigSchema>;
export type SearchDocument = z.infer<typeof searchDocumentSchema>;
export type Summary = z.infer<typeof summarySchema>;
