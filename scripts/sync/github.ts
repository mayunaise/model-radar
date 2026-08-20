import { Octokit } from "@octokit/rest";
import { normalizeGitHubItem } from "./normalize";
import type { GitHubGateway, RateLimit, RawGitHubItem, Repository } from "./types";

function splitSlug(slug: string): [string, string] {
  const [owner, repo] = slug.split("/");
  if (!owner || !repo) throw new Error(`Invalid repository slug: ${slug}`);
  return [owner, repo];
}

export async function collectRepository(
  gateway: GitHubGateway,
  repository: Repository,
  since: string,
  firstSeenAt: string,
) {
  const [owner, repo] = splitSlug(repository.canonicalSlug ?? repository.slug);
  const response = await gateway.listIssues({ owner, repo, since });
  const items = [];

  for (const raw of response.items) {
    if (raw.pull_request) {
      const pull = await gateway.getPull({ owner, repo, number: raw.number });
      items.push(normalizeGitHubItem(pull, repository.slug, "pr", firstSeenAt));
    } else {
      items.push(normalizeGitHubItem(raw, repository.slug, "issue", firstSeenAt));
    }
  }

  return { items, rateLimit: response.rateLimit };
}

function rateLimitFrom(headers: Record<string, string | undefined>): RateLimit {
  const reset = Number(headers["x-ratelimit-reset"] ?? 0) * 1000;
  return {
    remaining: Number(headers["x-ratelimit-remaining"] ?? 0),
    resetAt: new Date(reset || Date.now()).toISOString(),
  };
}

export function createGitHubGateway(token: string): GitHubGateway {
  const octokit = new Octokit({ auth: token });
  return {
    async listIssues({ owner, repo, since }) {
      const items: RawGitHubItem[] = [];
      let page = 1;
      let rateLimit: RateLimit = { remaining: 0, resetAt: new Date().toISOString() };
      while (true) {
        const response = await octokit.rest.issues.listForRepo({ owner, repo, since, state: "all", per_page: 100, page });
        items.push(...(response.data as RawGitHubItem[]));
        rateLimit = rateLimitFrom(response.headers as Record<string, string | undefined>);
        if (response.data.length < 100) break;
        page += 1;
      }
      return { items, rateLimit };
    },
    async getPull({ owner, repo, number }) {
      const response = await octokit.rest.pulls.get({ owner, repo, pull_number: number });
      return response.data as unknown as RawGitHubItem;
    },
  };
}
