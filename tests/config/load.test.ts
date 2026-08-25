import { describe, expect, test } from "vitest";
import { loadProjectConfig } from "../../src/lib/config/load";

describe("checked-in configuration", () => {
  test("loads the approved repositories, OpenAI limits, and capabilities", async () => {
    const config = await loadProjectConfig();

    expect(config.repositories.repositories.map((repo) => repo.slug)).toEqual([
      "hiyouga/LlamaFactory",
      "Ascend/MindSpeed-LLM",
      "volcengine/verl",
      "vllm-project/vllm",
    ]);
    expect(config.repositories.repositories[0]).toMatchObject({
      source: { provider: "github", slug: "hiyouga/LlamaFactory" },
      dataKey: "llamafactory",
      historyStartAt: "1970-01-01T00:00:00.000Z",
      backfillPageLimit: 2,
    });
    expect(config.repositories.repositories[1]?.source).toEqual({
      provider: "gitcode",
      slug: "Ascend/MindSpeed-LLM",
    });
    expect(config.openai.model).toBe("gpt-5.6-luna");
    expect(config.openai.dailyItemLimit).toBe(120);
    expect(config.capabilities.entries.length).toBeGreaterThanOrEqual(4);
    expect(config.keywords.global).toContain("GLM");
    expect(config.categories.categories).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "BUG",
          appliesTo: ["issue"],
          labels: { issue: "Bug" },
        }),
        expect.objectContaining({
          code: "FIX",
          appliesTo: ["pr"],
          labels: { pr: "Bug 修复" },
        }),
      ]),
    );
  });
});
