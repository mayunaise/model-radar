import { Octokit } from "@octokit/rest";
import { Agent, fetch as undiciFetch } from "undici";
import { normalizeGitHubItem } from "./normalize";
import { repositorySource, splitSourceSlug } from "./source";
import type { GitHubGateway, IssuePageRequest, PullDetail, RateLimit, RawGitHubItem, Repository, SearchPageRequest } from "./types";

export const GITHUB_RATE_LIMIT_FLOOR = 50;
export const GITHUB_SEARCH_RATE_LIMIT_FLOOR = 2;
export const GITHUB_REQUEST_TIMEOUT_MS = 15_000;
const GITHUB_TRANSIENT_RETRIES = 1;

// GitHub traffic must not inherit a workstation-wide proxy. The local proxy is
// useful for the OpenAI-compatible endpoint, but long GitHub syncs through it
// have produced hung HTTP/2 streams and EADDRNOTAVAIL on Node 26.
const githubDispatcher = new Agent({
  connect: { timeout: GITHUB_REQUEST_TIMEOUT_MS },
  headersTimeout: GITHUB_REQUEST_TIMEOUT_MS,
  bodyTimeout: GITHUB_REQUEST_TIMEOUT_MS,
});

const directGitHubFetch = (async (input: string | URL | Request, init?: RequestInit) => (
  undiciFetch(
    input as Parameters<typeof undiciFetch>[0],
    { ...init, dispatcher: githubDispatcher } as Parameters<typeof undiciFetch>[1],
  ) as unknown as Promise<Response>
)) as typeof globalThis.fetch;

async function expandPageItems(
  gateway: GitHubGateway,
  owner: string,
  repo: string,
  rawItems: RawGitHubItem[],
  repositorySlug: string,
  firstSeenAt: string,
  shouldExpandPull?: (item: RawGitHubItem) => boolean,
): Promise<{ items: ReturnType<typeof normalizeGitHubItem>[]; rateLimit?: RateLimit; usedBatch: boolean }> {
  const pullNumbers = rawItems
    .filter((item) => item.pull_request && !item.source_type && (shouldExpandPull?.(item) ?? true))
    .map((item) => item.number);
  if (pullNumbers.length === 0) {
    return {
      items: rawItems.map((raw) => normalizeGitHubItem(
        raw,
        repositorySlug,
        raw.source_type ?? (raw.pull_request ? "pr" : "issue"),
        firstSeenAt,
      )),
      rateLimit: undefined,
      usedBatch: true,
    };
  }
  if (!gateway.getPulls) return { items: [], rateLimit: undefined, usedBatch: false };
  const batch = await gateway.getPulls({ owner, repo, numbers: pullNumbers });
  const detailsByNumber = new Map(batch.details.map((detail) => [detail.number, detail]));
  const items = rawItems.map((raw) => {
    if (raw.source_type) return normalizeGitHubItem(raw, repositorySlug, raw.source_type, firstSeenAt);
    if (!raw.pull_request) return normalizeGitHubItem(raw, repositorySlug, "issue", firstSeenAt);
    const detail = detailsByNumber.get(raw.number);
    if (!detail && shouldExpandPull && !shouldExpandPull(raw)) {
      return normalizeGitHubItem(raw, repositorySlug, "pr", firstSeenAt);
    }
    if (!detail) throw new Error(`Missing batched GitHub PR detail for ${owner}/${repo}#${raw.number}`);
    return normalizeGitHubItem({
      ...raw,
      node_id: detail.nodeId,
      state: detail.state === "open" ? "open" : "closed",
      merged_at: detail.mergedAt,
    }, repositorySlug, "pr", firstSeenAt);
  });
  return { items, rateLimit: batch.rateLimit, usedBatch: true };
}

export async function collectRepositoryPage(
  gateway: GitHubGateway,
  repository: Repository,
  request: IssuePageRequest,
  firstSeenAt: string,
  shouldExpandPull?: (item: RawGitHubItem) => boolean,
) {
  const [owner, repo] = splitSourceSlug(repositorySource(repository).slug);
  const response = await gateway.listIssuesPage({ owner, repo, ...request });
  const expanded = await expandPageItems(gateway, owner, repo, response.items, repository.slug, firstSeenAt, shouldExpandPull);
  if (expanded.usedBatch) {
    return {
      items: expanded.items,
      hasNextPage: response.hasNextPage,
      pageComplete: true,
      rateLimit: expanded.rateLimit ?? response.rateLimit,
    };
  }
  const items = [];
  let rateLimit = response.rateLimit;
  let pageComplete = true;

  for (const raw of response.items) {
    if (raw.source_type === "pr" || raw.pull_request) {
      if (rateLimit.remaining < GITHUB_RATE_LIMIT_FLOOR) {
        pageComplete = false;
        break;
      }
      const pull = await gateway.getPull({ owner, repo, number: raw.number });
      rateLimit = pull.rateLimit;
      items.push(normalizeGitHubItem(pull.item, repository.slug, "pr", firstSeenAt));
    } else {
      items.push(normalizeGitHubItem(raw, repository.slug, "issue", firstSeenAt));
    }
  }

  return {
    items,
    hasNextPage: pageComplete ? response.hasNextPage : true,
    pageComplete,
    rateLimit,
  };
}

export async function collectRepositorySearchPage(
  gateway: GitHubGateway,
  repository: Repository,
  request: SearchPageRequest,
  firstSeenAt: string,
  shouldExpandPull?: (item: RawGitHubItem) => boolean,
) {
  if (!gateway.searchIssuesPage) throw new Error("GitHub search is not available");
  const [owner, repo] = splitSourceSlug(repositorySource(repository).slug);
  const response = await gateway.searchIssuesPage({ owner, repo, ...request });
  const expanded = await expandPageItems(gateway, owner, repo, response.items, repository.slug, firstSeenAt, shouldExpandPull);
  if (expanded.usedBatch) {
    return {
      items: expanded.items,
      hasNextPage: response.hasNextPage,
      pageComplete: true,
      rateLimit: expanded.rateLimit ?? response.rateLimit,
      rateLimitStop: (expanded.rateLimit?.remaining ?? Number.POSITIVE_INFINITY) < GITHUB_RATE_LIMIT_FLOOR
        || response.rateLimit.remaining < GITHUB_SEARCH_RATE_LIMIT_FLOOR,
    };
  }
  const items = [];
  let coreRateLimit: RateLimit | undefined;
  let pageComplete = true;

  for (const raw of response.items) {
    if (raw.source_type === "pr" || raw.pull_request) {
      if (coreRateLimit && coreRateLimit.remaining < GITHUB_RATE_LIMIT_FLOOR) {
        pageComplete = false;
        break;
      }
      const pull = await gateway.getPull({ owner, repo, number: raw.number });
      coreRateLimit = pull.rateLimit;
      items.push(normalizeGitHubItem(pull.item, repository.slug, "pr", firstSeenAt));
    } else {
      items.push(normalizeGitHubItem(raw, repository.slug, "issue", firstSeenAt));
    }
  }

  return {
    items,
    hasNextPage: pageComplete ? response.hasNextPage : true,
    pageComplete,
    rateLimit: coreRateLimit ?? response.rateLimit,
    rateLimitStop: Boolean(coreRateLimit && coreRateLimit.remaining < GITHUB_RATE_LIMIT_FLOOR)
      || response.rateLimit.remaining < GITHUB_SEARCH_RATE_LIMIT_FLOOR,
  };
}

export async function collectRepository(
  gateway: GitHubGateway,
  repository: Repository,
  since: string,
  firstSeenAt: string,
  shouldExpandPull?: (item: RawGitHubItem) => boolean,
  shouldStop?: () => boolean,
) {
  const items = [];
  let page = 1;
  let rateLimit: RateLimit = { remaining: 0, resetAt: firstSeenAt };
  let complete = false;
  while (true) {
    if (shouldStop?.()) break;
    const result = await collectRepositoryPage(
      gateway,
      repository,
      { since, page, sort: "updated", direction: "asc" },
      firstSeenAt,
      shouldExpandPull,
    );
    items.push(...result.items);
    rateLimit = result.rateLimit;
    if (shouldStop?.()) break;
    if (!result.pageComplete || rateLimit.remaining < GITHUB_RATE_LIMIT_FLOOR) {
      complete = result.pageComplete && !result.hasNextPage;
      break;
    }
    if (!result.hasNextPage) {
      complete = true;
      break;
    }
    page += 1;
  }
  return { items, rateLimit, complete };
}

function rateLimitFrom(headers: Record<string, string | undefined>): RateLimit {
  const reset = Number(headers["x-ratelimit-reset"] ?? 0) * 1000;
  return {
    remaining: Number(headers["x-ratelimit-remaining"] ?? 0),
    resetAt: new Date(reset || Date.now()).toISOString(),
  };
}

function hasNextLink(link: string | undefined): boolean {
  return link?.split(",").some((part) => /;\s*rel="next"\s*$/iu.test(part.trim())) ?? false;
}

async function withTransientRetry<T>(request: (signal: AbortSignal) => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= GITHUB_TRANSIENT_RETRIES; attempt += 1) {
    try {
      return await request(AbortSignal.timeout(GITHUB_REQUEST_TIMEOUT_MS));
    } catch (error) {
      lastError = error;
      const status = typeof error === "object" && error && "status" in error
        ? Number((error as { status: unknown }).status)
        : 0;
      if (attempt >= GITHUB_TRANSIENT_RETRIES || (status !== 0 && status < 500)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250 * (2 ** attempt)));
    }
  }
  throw lastError;
}

export function createGitHubGateway(token?: string): GitHubGateway {
  const octokit = new Octokit({
    auth: token || undefined,
    request: {
      timeout: GITHUB_REQUEST_TIMEOUT_MS,
      fetch: directGitHubFetch,
    },
  });
  return {
    async getIssue({ owner, repo, number }) {
      const response = await withTransientRetry((signal) => octokit.rest.issues.get({
        owner,
        repo,
        issue_number: number,
        request: { signal },
      }));
      return {
        item: response.data as RawGitHubItem,
        rateLimit: rateLimitFrom(response.headers as Record<string, string | undefined>),
      };
    },
    async listIssuesPage({ owner, repo, since, page, sort, direction }) {
      const response = await withTransientRetry((signal) => octokit.rest.issues.listForRepo({
        owner,
        repo,
        since,
        state: "all",
        per_page: 100,
        page,
        sort,
        direction,
        request: { signal },
      }));
      return {
        items: response.data as RawGitHubItem[],
        hasNextPage: hasNextLink(response.headers.link),
        rateLimit: rateLimitFrom(response.headers as Record<string, string | undefined>),
      };
    },
    async searchIssuesPage({ owner, repo, type, page }) {
      const response = await withTransientRetry((signal) => octokit.rest.search.issuesAndPullRequests({
        q: `repo:${owner}/${repo} GLM in:title is:${type}`,
        per_page: 100,
        page,
        sort: "created",
        order: "asc",
        request: { signal },
      }));
      return {
        items: response.data.items as RawGitHubItem[],
        hasNextPage: hasNextLink(response.headers.link),
        rateLimit: rateLimitFrom(response.headers as Record<string, string | undefined>),
      };
    },
    async getPulls({ owner, repo, numbers }) {
      const uniqueNumbers = [...new Set(numbers)];
      if (uniqueNumbers.length === 0) {
        return {
          details: [],
          rateLimit: { remaining: Number.POSITIVE_INFINITY, resetAt: new Date().toISOString() },
        };
      }
      if (uniqueNumbers.length > 100 || uniqueNumbers.some((number) => !Number.isInteger(number) || number < 1)) {
        throw new Error("GitHub PR batch must contain 1-100 positive integer numbers");
      }
      const selections = uniqueNumbers.map((number, index) => (
        `pr${index}: pullRequest(number: ${number}) { id number state mergedAt }`
      )).join("\n");
      const query = `query PullDetails($owner: String!, $repo: String!) {
        repository(owner: $owner, name: $repo) {
          ${selections}
        }
        rateLimit { remaining resetAt }
      }`;
      type GraphPull = { id: string; number: number; state: "OPEN" | "CLOSED" | "MERGED"; mergedAt: string | null };
      type GraphResponse = {
        repository: Record<string, GraphPull | null> | null;
        rateLimit: { remaining: number; resetAt: string };
      };
      const response = await withTransientRetry((signal) => octokit.graphql<GraphResponse>(query, {
        owner,
        repo,
        request: { signal },
      }));
      if (!response.repository) throw new Error(`GitHub repository not found: ${owner}/${repo}`);
      const details: PullDetail[] = uniqueNumbers.map((number, index) => {
        const pull = response.repository?.[`pr${index}`];
        if (!pull) throw new Error(`GitHub PR not found in batch: ${owner}/${repo}#${number}`);
        return {
          number: pull.number,
          nodeId: pull.id,
          state: pull.state === "MERGED" ? "merged" : pull.state === "OPEN" ? "open" : "closed",
          mergedAt: pull.mergedAt,
        };
      });
      return { details, rateLimit: response.rateLimit };
    },
    async getPull({ owner, repo, number }) {
      const response = await withTransientRetry((signal) => octokit.rest.pulls.get({
        owner,
        repo,
        pull_number: number,
        request: { signal },
      }));
      return {
        item: response.data as unknown as RawGitHubItem,
        rateLimit: rateLimitFrom(response.headers as Record<string, string | undefined>),
      };
    },
  };
}
