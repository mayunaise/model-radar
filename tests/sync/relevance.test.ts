import { describe, expect, test } from "vitest";
import { scoreRelevance } from "../../scripts/sync/relevance";
import type { NormalizedCandidate } from "../../scripts/sync/types";

const base: NormalizedCandidate = {
  id: "repo-issue-1",
  nodeId: "I_1",
  repository: "owner/repo",
  number: 1,
  type: "issue",
  title: "Unrelated title",
  bodyExcerpt: "Unrelated body",
  author: "alice",
  state: "open",
  labels: [],
  url: "https://github.com/owner/repo/issues/1",
  createdAt: "2026-08-20T00:00:00.000Z",
  updatedAt: "2026-08-20T00:00:00.000Z",
  mergedAt: null,
  firstSeenAt: "2026-08-20T00:00:00.000Z",
  contentHash: "sha256:x",
};

const keywords = {
  schemaVersion: 1 as const,
  global: ["GLM", "ChatGLM", "GLM-4"],
  includePatterns: ["chat[-_ ]?glm", "glm[-_ ]?[0-9.]*"],
  excludeTerms: ["generalized linear model"],
  scenarioTerms: {
    training: ["train", "finetune"],
    inference: ["infer", "serve"],
    rl: ["rlhf", "grpo"],
  },
};

describe("deterministic GLM relevance", () => {
  test.each([
    ["GLM-4 inference bug", "", 7, "eligible"],
    ["model support", "ChatGLM finetune fails", 4, "review"],
    ["generalized linear model notes", "GLM statistics", 0, "excluded"],
    ["unrelated", "no model reference", 0, "excluded"],
  ])("scores %s", (title, bodyExcerpt, score, disposition) => {
    expect(scoreRelevance({ ...base, title, bodyExcerpt }, keywords)).toMatchObject({
      score,
      disposition,
    });
  });
});
