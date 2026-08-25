import type { ActivityItem, KeywordConfig, RepositoryConfig } from "../../src/lib/domain/types";

export type Repository = RepositoryConfig["repositories"][number];
export type SourceProvider = "github" | "gitcode";
export type NormalizedCandidate = Omit<ActivityItem, "summary">;

export type RawGitHubItem = {
  node_id: string;
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  state: "open" | "closed";
  merged_at?: string | null;
  created_at: string;
  updated_at: string;
  user: { login: string } | null;
  labels: Array<{ name?: string } | string>;
  pull_request?: { url: string };
  source_type?: "issue" | "pr";
};

export type RateLimit = { remaining: number; resetAt: string };
export type PullDetail = {
  number: number;
  nodeId: string;
  state: "open" | "closed" | "merged";
  mergedAt: string | null;
};
export type IssuePageRequest = {
  since?: string;
  page: number;
  sort: "created" | "updated";
  direction: "asc";
};

export type SearchPageRequest = {
  type: "issue" | "pr";
  page: number;
};

export interface GitHubGateway {
  listIssuesPage(input: {
    owner: string;
    repo: string;
  } & IssuePageRequest): Promise<{ items: RawGitHubItem[]; hasNextPage: boolean; rateLimit: RateLimit }>;
  searchIssuesPage?(input: {
    owner: string;
    repo: string;
  } & SearchPageRequest): Promise<{ items: RawGitHubItem[]; hasNextPage: boolean; rateLimit: RateLimit }>;
  getPulls?(input: { owner: string; repo: string; numbers: number[] }): Promise<{
    details: PullDetail[];
    rateLimit: RateLimit;
  }>;
  getIssue?(input: { owner: string; repo: string; number: number }): Promise<{ item: RawGitHubItem; rateLimit: RateLimit }>;
  getPull(input: { owner: string; repo: string; number: number }): Promise<{ item: RawGitHubItem; rateLimit: RateLimit }>;
}

export type RelevanceResult = {
  score: number;
  disposition: "eligible" | "review" | "excluded";
  matchedTerms: string[];
  scenarios: Array<"TRAINING" | "INFERENCE" | "RL">;
};

export type SyncConfig = {
  repositories: Repository[];
  keywords: KeywordConfig;
};
