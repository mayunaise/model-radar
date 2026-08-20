import { createHash } from "node:crypto";
import type { NormalizedCandidate, RawGitHubItem } from "./types";

function stableId(repository: string, type: "issue" | "pr", number: number): string {
  const repo = repository.split("/").at(-1)?.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-") ?? "repo";
  return `${repo}-${type}-${number}`;
}

function labelsOf(item: RawGitHubItem): string[] {
  return item.labels
    .map((label) => (typeof label === "string" ? label : label.name ?? ""))
    .filter(Boolean);
}

export function normalizeGitHubItem(
  item: RawGitHubItem,
  repository: string,
  type: "issue" | "pr",
  firstSeenAt: string,
): NormalizedCandidate {
  const bodyExcerpt = [...(item.body ?? "")].slice(0, 2000).join("");
  const state = type === "pr" && item.merged_at ? "merged" : item.state;
  const contentHash = createHash("sha256")
    .update(JSON.stringify([item.title, bodyExcerpt, state, labelsOf(item), item.updated_at]))
    .digest("hex");

  return {
    id: stableId(repository, type, item.number),
    nodeId: item.node_id,
    repository,
    number: item.number,
    type,
    title: item.title,
    bodyExcerpt,
    author: item.user?.login ?? "ghost",
    state,
    labels: labelsOf(item),
    url: item.html_url,
    createdAt: new Date(item.created_at).toISOString(),
    updatedAt: new Date(item.updated_at).toISOString(),
    mergedAt: item.merged_at ? new Date(item.merged_at).toISOString() : null,
    firstSeenAt,
    contentHash: `sha256:${contentHash}`,
  };
}
