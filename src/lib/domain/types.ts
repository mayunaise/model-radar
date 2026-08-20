import type { z } from "zod";
import type {
  activityItemSchema,
  capabilityCandidateSchema,
  capabilityConfigSchema,
  capabilityEntrySchema,
  dailyReportSchema,
  eventSchema,
  keywordConfigSchema,
  manifestSchema,
  metaSchema,
  openAiConfigSchema,
  repositoryConfigSchema,
  searchDocumentSchema,
  summarySchema,
} from "./schemas";

export type ActivityItem = z.infer<typeof activityItemSchema>;
export type CapabilityCandidate = z.infer<typeof capabilityCandidateSchema>;
export type CapabilityConfig = z.infer<typeof capabilityConfigSchema>;
export type CapabilityEntry = z.infer<typeof capabilityEntrySchema>;
export type DailyReport = z.infer<typeof dailyReportSchema>;
export type DataEvent = z.infer<typeof eventSchema>;
export type KeywordConfig = z.infer<typeof keywordConfigSchema>;
export type Manifest = z.infer<typeof manifestSchema>;
export type Meta = z.infer<typeof metaSchema>;
export type OpenAiConfig = z.infer<typeof openAiConfigSchema>;
export type RepositoryConfig = z.infer<typeof repositoryConfigSchema>;
export type SearchDocument = z.infer<typeof searchDocumentSchema>;
export type Summary = z.infer<typeof summarySchema>;
