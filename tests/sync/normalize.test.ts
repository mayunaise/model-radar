import { describe, expect, test } from "vitest";
import { normalizeGitHubItem } from "../../scripts/sync/normalize";
import { activityItemSchema } from "../../src/lib/domain/schemas";

describe("GitHub item normalization", () => {
  test("assigns a deterministic category before any AI summary exists", () => {
    const candidate = normalizeGitHubItem({
      node_id: "LOCAL_CATEGORY",
      number: 2,
      title: "Fix GLM inference crash",
      body: "The model crashes during generation.",
      html_url: "https://github.com/example/repository/pull/2",
      state: "closed",
      merged_at: "2026-08-21T00:30:00.000Z",
      created_at: "2026-08-21T00:00:00.000Z",
      updated_at: "2026-08-21T00:30:00.000Z",
      user: { login: "tester" },
      labels: [{ name: "bug" }],
    }, "example/repository", "pr", "2026-08-21T01:00:00.000Z");

    expect(candidate).toMatchObject({ category: "FIX", categorySource: "rules" });
  });

  test("keeps Unicode body excerpts within the schema's UTF-16 length limit", () => {
    const candidate = normalizeGitHubItem({
      node_id: "UNICODE_BODY",
      number: 1,
      title: "GLM Unicode body",
      body: `${"a".repeat(1999)}😀tail`,
      html_url: "https://github.com/example/repository/issues/1",
      state: "open",
      created_at: "2026-08-21T00:00:00.000Z",
      updated_at: "2026-08-21T00:00:00.000Z",
      user: { login: "tester" },
      labels: [],
    }, "example/repository", "issue", "2026-08-21T01:00:00.000Z");

    expect(() => activityItemSchema.parse({ ...candidate, summary: null })).not.toThrow();
    expect(candidate.bodyExcerpt.length).toBeLessThanOrEqual(2000);
    expect(candidate.bodyExcerpt.endsWith("\ud83d")).toBe(false);
  });
});
