import { describe, expect, test } from "vitest";
import { readBuilt } from "../helpers/build-site";

describe("activity pages", () => {
  test("publishes a filterable activity index", async () => {
    const html = await readBuilt("activity/index.html");

    expect(html).toContain("Issue / PR 动态库");
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("vllm-project/vllm");
    expect(html).toContain("重置筛选");
  });

  test("publishes one traceable static page per item", async () => {
    const html = await readBuilt(
      "activity/vllm-project-vllm/10004/index.html",
    );

    expect(html).toContain("推理输出一致性修复已合并");
    expect(html).toContain("GLM 相关性依据");
    expect(html).toContain("查看 GitHub 原文");
    expect(html).toContain('rel="noreferrer"');
  });
});
