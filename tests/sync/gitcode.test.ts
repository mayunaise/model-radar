import { describe, expect, test } from "vitest";
import { createGitCodeGateway } from "../../scripts/sync/gitcode";

describe("GitCode collection boundary", () => {
  test("collects Issue and PR streams with header-only authentication", async () => {
    const requests: Array<{ url: string; authorization: string | null }> = [];
    const requestFetch = async (url: string, init: Parameters<typeof fetch>[1]) => {
      requests.push({
        url,
        authorization: new Headers(init?.headers).get("authorization"),
      });
      const isPull = url.includes("/pulls?");
      const body = isPull ? [{
        id: 4610,
        number: 4610,
        title: "feat: Add GLM5.2 model support",
        body: "Add adaptation support for GLM5.2 model.",
        html_url: "https://gitcode.com/Ascend/MindSpeed-LLM/merge_requests/4610",
        state: "merged",
        created_at: "2026-07-20T10:00:00+08:00",
        updated_at: "2026-07-21T10:00:00+08:00",
        merged_at: "2026-07-21T10:00:00+08:00",
        user: { login: "contributor" },
        labels: [{ name: "model" }],
      }] : [{
        id: 1701,
        number: "1701",
        title: "GLM5.2 ShareIndex cache error",
        body: "GLM5.2 training recomputation returns a stale index.",
        html_url: "https://gitcode.com/Ascend/MindSpeed-LLM/issues/1701",
        state: "opened",
        created_at: "2026-08-01T10:00:00+08:00",
        updated_at: "2026-08-02T10:00:00+08:00",
        user: { login: "reporter" },
        labels: [{ name: "bug" }],
      }];
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json", total_page: isPull ? "1" : "2" },
      });
    };
    const gateway = createGitCodeGateway("secret-token", requestFetch as never, 0);

    const result = await gateway.listIssuesPage({
      owner: "Ascend",
      repo: "MindSpeed-LLM",
      since: "2026-08-01T00:00:00.000Z",
      page: 1,
      sort: "updated",
      direction: "asc",
    });

    expect(requests).toHaveLength(2);
    expect(requests.every((request) => request.authorization === "Bearer secret-token")).toBe(true);
    expect(requests.every((request) => !request.url.includes("secret-token"))).toBe(true);
    expect(requests.every((request) => request.url.includes("since=2026-08-01T00%3A00%3A00.000Z"))).toBe(true);
    expect(result.hasNextPage).toBe(true);
    expect(result.items.map((item) => [item.source_type, item.number, item.state, item.merged_at])).toEqual([
      ["issue", 1701, "open", null],
      ["pr", 4610, "closed", "2026-07-21T10:00:00+08:00"],
    ]);
    expect(result.items[1]?.html_url).toBe("https://gitcode.com/Ascend/MindSpeed-LLM/merge_requests/4610");
  });

  test("supports public repositories without sending an authorization header", async () => {
    let authorization: string | null = "unexpected";
    const gateway = createGitCodeGateway(undefined, (async (_url: string, init: Parameters<typeof fetch>[1]) => {
      authorization = new Headers(init?.headers).get("authorization");
      return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
    }) as never, 0);

    await gateway.listIssuesPage({ owner: "Ascend", repo: "MindSpeed-LLM", page: 1, sort: "updated", direction: "asc" });
    expect(authorization).toBeNull();
  });

  test("stops requesting a shorter resource after its last known page", async () => {
    const urls: string[] = [];
    const gateway = createGitCodeGateway(undefined, (async (url: string) => {
      urls.push(url);
      const isIssue = url.includes("/issues?");
      return new Response("[]", {
        status: 200,
        headers: {
          "content-type": "application/json",
          total_page: isIssue ? "1" : "3",
        },
      });
    }) as never, 0);

    for (const page of [1, 2, 3]) {
      await gateway.listIssuesPage({ owner: "Ascend", repo: "MindSpeed-LLM", page, sort: "created", direction: "asc" });
    }

    expect(urls.filter((url) => url.includes("/issues?"))).toHaveLength(1);
    expect(urls.filter((url) => url.includes("/pulls?"))).toHaveLength(3);
  });
});
