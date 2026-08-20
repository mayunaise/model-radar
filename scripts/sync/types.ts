import type { ActivityItem, KeywordConfig, RepositoryConfig } from "../../src/lib/domain/types";

export type Repository = RepositoryConfig["repositories"][number];
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
};

export type RateLimit = { remaining: number; resetAt: string };

export interface GitHubGateway {
  listIssues(input: {
    owner: string;
    repo: string;
    since: string;
  }): Promise<{ items: RawGitHubItem[]; rateLimit: RateLimit }>;
  getPull(input: { owner: string; repo: string; number: number }): Promise<RawGitHubItem>;
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
