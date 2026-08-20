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
    expect(config.openai.model).toBe("gpt-5.6-luna");
    expect(config.openai.dailyItemLimit).toBe(120);
    expect(config.capabilities.entries.length).toBeGreaterThanOrEqual(4);
    expect(config.keywords.global).toContain("GLM");
  });
});
