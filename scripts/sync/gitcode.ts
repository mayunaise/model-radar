import { Agent, fetch as undiciFetch } from "undici";
import type { GitHubGateway, IssuePageRequest, RateLimit, RawGitHubItem } from "./types";

const GITCODE_API_ROOT = "https://api.gitcode.com/api/v5";
export const GITCODE_REQUEST_TIMEOUT_MS = 15_000;
const GITCODE_TRANSIENT_RETRIES = 1;
const PAGE_SIZE = 100;

type GitCodeItem = {
  id: number | string;
  number: number | string;
  title: string;
  body?: string | null;
  html_url?: string;
  state: "open" | "opened" | "closed" | "merged" | "locked";
  created_at: string;
  updated_at: string;
  merged_at?: string | null;
  finished_at?: string | null;
  user?: { login?: string; name?: string } | null;
  author?: { username?: string; login?: string; name?: string } | null;
  labels?: Array<{ name?: string; title?: string } | string>;
};

type PageResult = { items: GitCodeItem[]; hasNextPage: boolean; totalPages?: number; rateLimit: RateLimit };
type GitCodeFetch = (input: string, init: Parameters<typeof undiciFetch>[1]) => Promise<Response>;

const dispatcher = new Agent({
  connect: { timeout: GITCODE_REQUEST_TIMEOUT_MS },
  headersTimeout: GITCODE_REQUEST_TIMEOUT_MS,
  bodyTimeout: GITCODE_REQUEST_TIMEOUT_MS,
});

function stateOf(value: GitCodeItem["state"]): "open" | "closed" {
  return value === "open" || value === "opened" ? "open" : "closed";
}

function normalizeGitCodeItem(
  item: GitCodeItem,
  owner: string,
  repo: string,
  type: "issue" | "pr",
): RawGitHubItem {
  const number = Number(item.number);
  if (!Number.isInteger(number) || number < 1) throw new Error(`Invalid GitCode item number: ${item.number}`);
  const author = item.user?.login ?? item.author?.username ?? item.author?.login ?? item.user?.name ?? item.author?.name ?? "ghost";
  const path = type === "pr" ? "merge_requests" : "issues";
  return {
    node_id: `gitcode-${type}-${String(item.id)}`,
    number,
    title: item.title,
    body: item.body ?? null,
    html_url: item.html_url?.replace("api.gitcode.net", "gitcode.com")
      ?? `https://gitcode.com/${owner}/${repo}/${path}/${number}`,
    state: stateOf(item.state),
    merged_at: type === "pr" && item.state === "merged" ? item.merged_at ?? item.updated_at : item.merged_at ?? null,
    created_at: item.created_at,
    updated_at: item.updated_at,
    user: { login: author },
    labels: item.labels ?? [],
    source_type: type,
  };
}

function rateLimitFrom(headers: Headers): RateLimit {
  const remaining = Number(headers.get("x-ratelimit-remaining") ?? Number.MAX_SAFE_INTEGER);
  const reset = headers.get("x-ratelimit-reset");
  return {
    remaining: Number.isFinite(remaining) ? remaining : Number.MAX_SAFE_INTEGER,
    resetAt: reset && /^\d+$/u.test(reset)
      ? new Date(Number(reset) * 1000).toISOString()
      : new Date(Date.now() + 60_000).toISOString(),
  };
}

function pagination(headers: Headers, page: number, itemCount: number): { hasNextPage: boolean; totalPages?: number } {
  const totalPages = Number(headers.get("total_page") ?? headers.get("x-total-pages") ?? 0);
  return totalPages > 0
    ? { hasNextPage: page < totalPages, totalPages }
    : { hasNextPage: itemCount === PAGE_SIZE };
}

function paramsFor(request: IssuePageRequest): URLSearchParams {
  const parameters = new URLSearchParams({
    state: "all",
    sort: request.sort,
    direction: request.direction,
    page: String(request.page),
    per_page: String(PAGE_SIZE),
  });
  if (request.since) parameters.set("since", request.since);
  return parameters;
}

async function requestPage(
  requestFetch: GitCodeFetch,
  beforeRequest: () => Promise<void>,
  token: string | undefined,
  owner: string,
  repo: string,
  resource: "issues" | "pulls",
  request: IssuePageRequest,
): Promise<PageResult> {
  const url = `${GITCODE_API_ROOT}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${resource}?${paramsFor(request)}`;
  let lastError: unknown;
  for (let attempt = 0; attempt <= GITCODE_TRANSIENT_RETRIES; attempt += 1) {
    try {
      await beforeRequest();
      const response = await requestFetch(url, {
        headers: { accept: "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        dispatcher,
        signal: AbortSignal.timeout(GITCODE_REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) {
        const error = Object.assign(new Error(`GitCode API request failed with ${response.status}`), { status: response.status });
        throw error;
      }
      const items = await response.json() as GitCodeItem[];
      if (!Array.isArray(items)) throw new Error("GitCode API returned a non-list response");
      const pageInfo = pagination(response.headers, request.page, items.length);
      return {
        items,
        ...pageInfo,
        rateLimit: rateLimitFrom(response.headers),
      };
    } catch (error) {
      lastError = error;
      const status = typeof error === "object" && error && "status" in error
        ? Number((error as { status: unknown }).status)
        : 0;
      if (attempt >= GITCODE_TRANSIENT_RETRIES || (status !== 0 && status < 500)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250 * (2 ** attempt)));
    }
  }
  throw lastError;
}

async function requestItem(
  requestFetch: GitCodeFetch,
  beforeRequest: () => Promise<void>,
  token: string | undefined,
  owner: string,
  repo: string,
  resource: "issues" | "pulls",
  number: number,
): Promise<{ item: RawGitHubItem; rateLimit: RateLimit }> {
  const url = `${GITCODE_API_ROOT}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${resource}/${number}`;
  await beforeRequest();
  const response = await requestFetch(url, {
    headers: { accept: "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    dispatcher,
    signal: AbortSignal.timeout(GITCODE_REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw Object.assign(new Error(`GitCode API request failed with ${response.status}`), { status: response.status });
  const raw = await response.json() as GitCodeItem;
  return {
    item: normalizeGitCodeItem(raw, owner, repo, resource === "pulls" ? "pr" : "issue"),
    rateLimit: rateLimitFrom(response.headers),
  };
}

export function createGitCodeGateway(
  token?: string,
  requestFetch: GitCodeFetch = undiciFetch as unknown as GitCodeFetch,
  anonymousIntervalMs = 1_100,
): GitHubGateway {
  const normalizedToken = token?.trim() || undefined;
  let nextAnonymousRequestAt = 0;
  const beforeRequest = async () => {
    if (normalizedToken || anonymousIntervalMs <= 0) return;
    const now = Date.now();
    const waitMs = Math.max(0, nextAnonymousRequestAt - now);
    nextAnonymousRequestAt = Math.max(now, nextAnonymousRequestAt) + anonymousIntervalMs;
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
  };
  const totalPagesByResource = new Map<string, number>();
  const pageFor = async (
    owner: string,
    repo: string,
    resource: "issues" | "pulls",
    input: IssuePageRequest,
  ): Promise<PageResult> => {
    const key = `${owner}/${repo}/${resource}`;
    const knownTotal = totalPagesByResource.get(key);
    if (knownTotal !== undefined && input.page > knownTotal) {
      return {
        items: [],
        hasNextPage: false,
        totalPages: knownTotal,
        rateLimit: { remaining: Number.MAX_SAFE_INTEGER, resetAt: new Date(Date.now() + 60_000).toISOString() },
      };
    }
    const result = await requestPage(requestFetch, beforeRequest, normalizedToken, owner, repo, resource, input);
    if (result.totalPages !== undefined) totalPagesByResource.set(key, result.totalPages);
    return result;
  };
  return {
    async listIssuesPage(input) {
      const [issues, pulls] = await Promise.all([
        pageFor(input.owner, input.repo, "issues", input),
        pageFor(input.owner, input.repo, "pulls", input),
      ]);
      return {
        items: [
          ...issues.items.map((item) => normalizeGitCodeItem(item, input.owner, input.repo, "issue")),
          ...pulls.items.map((item) => normalizeGitCodeItem(item, input.owner, input.repo, "pr")),
        ],
        hasNextPage: issues.hasNextPage || pulls.hasNextPage,
        rateLimit: issues.rateLimit.remaining <= pulls.rateLimit.remaining ? issues.rateLimit : pulls.rateLimit,
      };
    },
    getIssue(input) {
      return requestItem(requestFetch, beforeRequest, normalizedToken, input.owner, input.repo, "issues", input.number);
    },
    getPull(input) {
      return requestItem(requestFetch, beforeRequest, normalizedToken, input.owner, input.repo, "pulls", input.number);
    },
  };
}
